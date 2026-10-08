import type { Coupon, CouponDecision, DecisionMode, DecisionTraceStep, InsuranceProduct, StageResult, UserNeed, UserProfile } from '../../shared/types';
import type { LLMProvider } from '../llm/LLMProvider';
import { couponDecisionSchema } from '../schemas';

type Check={rule:string;label:string;actual:unknown;expected:unknown;pass:boolean;code:string};
type Evaluation={coupon:Coupon;checks:Check[];eligible:boolean;firstFailure:string|null};

function rejected(reasonCodes:string[],rejectedCoupons:CouponDecision['rejected_coupon_ids'],fallback:CouponDecision['fallback_status']='none'):CouponDecision{
  return {decision:fallback==='manual_review'?'review':'reject',selected_coupon_id:null,discount_value:0,currency:'MYR',eligible_product_ids:[],reason_codes:reasonCodes,rejected_coupon_ids:rejectedCoupons,fallback_status:fallback};
}

function evaluateCoupon(coupon:Coupon,profile:UserProfile,products:InsuranceProduct[],now:Date):Evaluation{
  const productScope=coupon.eligible_product_ids.some((id)=>products.some((p)=>p.product_id===id&&p.active&&p.annual_premium>=coupon.minimum_premium&&p.coupon_ids.includes(coupon.coupon_id)));
  const checks:Check[]=[
    {rule:'market',label:'市场',actual:profile.market,expected:coupon.eligible_markets,pass:coupon.eligible_markets.includes(profile.market),code:'MARKET_NOT_ELIGIBLE'},
    {rule:'segment',label:'用户分群',actual:profile.segment,expected:coupon.eligible_segments,pass:coupon.eligible_segments.includes(profile.segment),code:'SEGMENT_NOT_ELIGIBLE'},
    {rule:'renewal_window_days',label:'续保时间窗口',actual:profile.renewal_due_days,expected:'不超过30天',pass:profile.renewal_due_days<=30,code:'RENEWAL_WINDOW_NOT_ELIGIBLE'},
    {rule:'campaign_status',label:'活动状态与有效期',actual:`${coupon.status} · ${coupon.valid_from} 至 ${coupon.valid_to}`,expected:'活动有效',pass:coupon.status==='active'&&now>=new Date(coupon.valid_from+'T00:00:00Z')&&now<=new Date(coupon.valid_to+'T23:59:59Z'),code:'COUPON_NOT_ACTIVE'},
    {rule:'budget',label:'活动预算',actual:coupon.budget_remaining,expected:`至少 MYR ${coupon.discount_value}`,pass:coupon.budget_remaining>=coupon.discount_value,code:'CAMPAIGN_BUDGET_INSUFFICIENT'},
    {rule:'frequency_30d',label:'近30天领取频控',actual:profile.coupon_received_30d,expected:`少于 ${coupon.per_user_limit_30d} 张`,pass:profile.coupon_received_30d<coupon.per_user_limit_30d,code:'FREQUENCY_LIMIT_REACHED'},
    {rule:'product_scope',label:'适用产品范围',actual:coupon.eligible_product_ids,expected:`双方映射一致、产品在售且保费不低于 MYR ${coupon.minimum_premium}`,pass:productScope,code:'NO_ELIGIBLE_PRODUCT_SCOPE'},
    {rule:'maximum_discount',label:'最大折扣限制',actual:coupon.discount_value,expected:`不超过 MYR ${coupon.maximum_discount}`,pass:coupon.discount_value<=coupon.maximum_discount,code:'MAX_DISCOUNT_EXCEEDED'}
  ];
  const failure=checks.find((check)=>!check.pass);
  return {coupon,checks,eligible:!failure,firstFailure:failure?.code??null};
}

function toDecision(selected:Coupon|null,evaluations:Evaluation[],mode:'hybrid'|'rules_only'):CouponDecision{
  const rejectedCoupons=evaluations.filter((x)=>!x.eligible).map((x)=>({coupon_id:x.coupon.coupon_id,reason_code:x.firstFailure!}));
  if(!selected)return rejected(['NO_ELIGIBLE_COUPON'],rejectedCoupons);
  return {decision:'grant',selected_coupon_id:selected.coupon_id,discount_value:selected.discount_value,currency:'MYR',eligible_product_ids:selected.eligible_product_ids,reason_codes:['RULE_PREFILTER_PASSED',mode==='hybrid'?'LLM_RANK_RECORDED':'DETERMINISTIC_RANK_RECORDED','FINAL_RULE_CHECK_PASSED'],rejected_coupon_ids:rejectedCoupons,fallback_status:'none'};
}

function ruleTrace(need:UserNeed,profile:UserProfile,evaluations:Evaluation[],upstreamBlocked:boolean):DecisionTraceStep[]{
  const trace:DecisionTraceStep[]=[{step_id:'coupon-upstream-gate',stage:'coupon',kind:'validation',title:'上游需求门禁',description:'关键字段缺失或冲突时禁止继续发券。',input:{missing_fields:need.missing_fields,information_status:need.information_status},logic:'关键信息缺失或冲突 → 阻断',output:{blocked:upstreamBlocked},status:upstreamBlocked?'failed':'passed',reason_code:upstreamBlocked?'HIGH_RISK_COUPON_BLOCKED':'UPSTREAM_SCHEMA_VALID'}];
  for(const evaluation of evaluations){
    trace.push({step_id:`coupon-${evaluation.coupon.coupon_id}`,stage:'coupon',kind:'rule',title:`规则预筛 ${evaluation.coupon.coupon_id}`,description:'按固定顺序检查资格；任一条件失败即不进入 LLM 候选池。',input:{batch_name:evaluation.coupon.batch_name,profile_user:profile.user_id,checks:evaluation.checks.map(({rule,label,actual,expected})=>({rule,label,actual,expected}))},logic:'市场 → 分群 → 续保窗口 → 活动状态 → 预算 → 频控 → 产品范围 → 最大折扣',output:{checks:evaluation.checks.map(({rule,label,pass,code})=>({rule,label,pass,reason_code:pass?'PASS':code})),eligible:!upstreamBlocked&&evaluation.eligible,first_failure:evaluation.firstFailure},status:upstreamBlocked?'info':evaluation.eligible?'passed':'failed',reason_code:evaluation.firstFailure??'COUPON_ELIGIBLE'});
  }
  return trace;
}

export async function runCoupon(need:UserNeed|null,profile:UserProfile,coupons:Coupon[],products:InsuranceProduct[],mode:DecisionMode,llm:LLMProvider,now=new Date('2026-08-24T00:00:00Z')):Promise<StageResult<CouponDecision>>{
  const started=Date.now();
  if(!need)return {input:{need,profile},output:null,decision_summary:['Chat 输出无效，优惠券节点被阻断'],node_logs:[{node:'coupon.upstream',status:'failed',summary:'USER_NEED_MISSING',duration_ms:0}],trace:[],schema_valid:false,retry_count:0,fallback_status:'manual_review',error:'UPSTREAM_SCHEMA_INVALID'};
  const invalidConfig=coupons.filter((coupon)=>coupon.discount_value>coupon.maximum_discount||coupon.budget_remaining<0);
  if(invalidConfig.length){
    const decision=rejected(['RULE_CONFIGURATION_CONFLICT'],invalidConfig.map((coupon)=>({coupon_id:coupon.coupon_id,reason_code:'INVALID_DISCOUNT_OR_BUDGET'})),'manual_review');
    return {input:{invalid_coupon_ids:invalidConfig.map((x)=>x.coupon_id)},output:decision,decision_summary:['Voucher规则配置冲突，转人工核对'],node_logs:[{node:'coupon.configuration',status:'failed',summary:'invalid discount or budget',duration_ms:Date.now()-started}],trace:[{step_id:'coupon-config-conflict',stage:'coupon',kind:'validation',title:'Voucher配置检查',description:'折扣超过上限或预算为负时不运行发券流程。',input:{invalidConfig},logic:'discount_value <= maximum_discount AND budget_remaining >= 0',output:{blocked:true},status:'failed',reason_code:'RULE_CONFIGURATION_CONFLICT'}],schema_valid:true,retry_count:0,fallback_status:'manual_review'};
  }
  if(mode==='llm_only'){
    const parsed=couponDecisionSchema.safeParse(await llm.chooseCoupon(need,profile,coupons));
    if(!parsed.success)return {input:{need,profile},output:null,decision_summary:['LLM 输出未通过 Schema，禁止发券'],node_logs:[{node:'coupon.schema',status:'failed',summary:parsed.error.message,duration_ms:Date.now()-started}],trace:[],schema_valid:false,retry_count:0,fallback_status:'manual_review',error:'COUPON_SCHEMA_INVALID'};
    const decision=parsed.data;
    return {input:{need,profile_snapshot_id:profile.profile_snapshot_id,candidate_batches:coupons.map((x)=>x.coupon_id)},output:decision,decision_summary:['LLM 从全部原始券中直接选择；本对照组刻意跳过资格规则'],node_logs:[{node:'coupon.llm_decision',status:'warning',summary:decision.selected_coupon_id??'no coupon',duration_ms:Date.now()-started}],trace:[{step_id:'coupon-llm-only',stage:'coupon',kind:'llm',title:'LLM 直接发券（对照组）',description:'复用同一 LLM 节点，但不执行规则预筛和最终确认。',input:{candidate_batches:coupons.map((x)=>x.coupon_id)},logic:'全部券 → LLM选择 → 仅Schema校验',output:{decision},status:'warning',reason_code:'LLM_ONLY_UNSAFE_PATH'}],schema_valid:true,retry_count:0,fallback_status:decision.fallback_status};
  }
  const upstreamBlocked=need.information_status==='needs_clarification'&&need.missing_fields.some((field)=>['vehicle.type','budget.conflict_requires_confirmation'].includes(field));
  const evaluations=coupons.map((coupon)=>evaluateCoupon(coupon,profile,products,now));
  const trace=ruleTrace(need,profile,evaluations,upstreamBlocked);
  if(upstreamBlocked){
    const decision=rejected(['UPSTREAM_FIELDS_INCOMPLETE','HIGH_RISK_COUPON_BLOCKED'],[],'clarification_required');
    return {input:{need,profile_snapshot:{user_id:profile.user_id,market:profile.market,segment:profile.segment}},output:decision,decision_summary:['关键信息不完整，未进入候选券排序'],node_logs:[{node:'coupon.upstream',status:'warning',summary:'blocked',duration_ms:Date.now()-started}],trace,schema_valid:true,retry_count:0,fallback_status:decision.fallback_status};
  }
  const eligible=evaluations.filter((x)=>x.eligible).map((x)=>x.coupon);
  let selected:Coupon|null=null;
  if(mode==='hybrid'&&eligible.length){
    const suggestion=couponDecisionSchema.parse(await llm.chooseCoupon(need,profile,eligible));
    selected=eligible.find((coupon)=>coupon.coupon_id===suggestion.selected_coupon_id&&coupon.discount_value===suggestion.discount_value)??null;
    trace.push({step_id:'coupon-llm-rank',stage:'coupon',kind:'llm',title:'LLM 排序合资格券',description:'模型只能在规则预筛后的候选池中表达语义偏好。',input:{need_summary:need.evidence_summary,eligible_batches:eligible.map((x)=>x.coupon_id)},logic:'合资格券 → LLM语义排序',output:{selected_coupon_id:suggestion.selected_coupon_id,accepted:Boolean(selected)},status:selected?'passed':'warning',reason_code:selected?'LLM_RANK_ACCEPTED':'LLM_SELECTION_OUTSIDE_ELIGIBLE_SET'});
  }else if(mode==='rules_only')selected=[...eligible].sort((a,b)=>b.discount_value-a.discount_value||a.coupon_id.localeCompare(b.coupon_id))[0]??null;
  if(selected){const final=evaluateCoupon(selected,profile,products,now);if(!final.eligible)selected=null;}
  const decision=toDecision(selected,evaluations,mode);
  trace.push({step_id:'coupon-final-decision',stage:'coupon',kind:'validation',title:'规则最终确认',description:'再次确认候选仍满足资格、金额、预算和频控；规则拥有最终权威。',input:{selected_coupon_id:selected?.coupon_id??null},logic:'重新执行资格规则 → 输出最终券',output:{decision},status:decision.decision==='grant'?'passed':'info',reason_code:decision.decision==='grant'?'FINAL_RULE_CHECK_PASSED':'NO_ELIGIBLE_COUPON'});
  return {input:{need,profile_snapshot:{profile_snapshot_id:profile.profile_snapshot_id,user_id:profile.user_id,market:profile.market,segment:profile.segment,renewal_due_days:profile.renewal_due_days,coupon_received_30d:profile.coupon_received_30d}},output:decision,decision_summary:[mode==='hybrid'?'规则预筛 → LLM排序 → 规则终审':'规则预筛 → 固定排序 → 规则终审',`合资格券 ${eligible.length} 张`,decision.decision==='grant'?`最终发放 ${decision.selected_coupon_id}`:'没有可发放的券'],node_logs:[{node:'coupon.hybrid_orchestration',status:'success',summary:`eligible=${eligible.length}; selected=${decision.selected_coupon_id??'none'}`,duration_ms:Date.now()-started}],trace,schema_valid:true,retry_count:0,fallback_status:decision.fallback_status};
}
