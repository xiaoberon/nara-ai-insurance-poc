import type { CouponDecision, DecisionMode, DecisionTraceStep, InsuranceProduct, RecommendationResult, RecommendedProduct, StageResult, UserNeed, UserProfile } from '../../shared/types';
import type { LLMProvider } from '../llm/LLMProvider';
import { recommendationResultSchema } from '../schemas';

const rankingWeights={coverage:60,budget:40} as const;

function hardReasons(product: InsuranceProduct, profile: UserProfile, coupon: CouponDecision): string[] {
  const reasons:string[]=[];
  if (!product.active) reasons.push('PRODUCT_INACTIVE');
  if (product.market!==profile.market) reasons.push('MARKET_MISMATCH');
  if (!product.eligible_vehicle_types.includes(profile.vehicle_type)) reasons.push('VEHICLE_TYPE_NOT_ELIGIBLE');
  if (profile.vehicle_age_years>product.maximum_vehicle_age_years) reasons.push('VEHICLE_AGE_NOT_ELIGIBLE');
  if (coupon.decision==='grant' && (!coupon.eligible_product_ids.includes(product.product_id) || !product.coupon_ids.includes(coupon.selected_coupon_id!))) reasons.push('COUPON_SCOPE_MISMATCH');
  return reasons;
}

function rankByRules(need: UserNeed, profile: UserProfile, coupon: CouponDecision, products: InsuranceProduct[]):RecommendationResult {
  const excluded:RecommendationResult['excluded_products']=[];
  const eligible=products.filter((product)=>{
    const reasons=hardReasons(product,profile,coupon);
    if (reasons.length) excluded.push({product_id:product.product_id,reason_codes:reasons});
    return reasons.length===0;
  });
  const scored=eligible.map((product):RecommendedProduct=>{
    const priorityMatches=need.coverage_priorities.filter((tag)=>tag==='roadside_assistance'?product.roadside_assistance:product.coverage_tags.includes(tag));
    const coverageAvailable=need.coverage_priorities.length>0;
    const coverageRatio=coverageAvailable?priorityMatches.length/need.coverage_priorities.length:0;
    const coverage=rankingWeights.coverage*coverageRatio;
    const max=need.budget.max_annual_premium;
    const afterCoupon=product.annual_premium-(coupon.decision==='grant'?coupon.discount_value:0);
    const budgetAvailable=max!==null;
    const budgetRatio=max===null?0:afterCoupon<=max?1:Math.max(0,1-(afterCoupon-max)/Math.max(max,1));
    const budget=rankingWeights.budget*budgetRatio;
    const breakdown={coverage:+coverage.toFixed(1),budget:+budget.toFixed(1)};
    const availableWeight=(coverageAvailable?rankingWeights.coverage:0)+(budgetAvailable?rankingWeights.budget:0);
    const score=availableWeight?(coverage+budget)/availableWeight*100:0;
    const reasons=[...priorityMatches.map((tag)=>`匹配保障：${tag}`),...(max!==null&&afterCoupon<=max?['优惠后价格在预算内']:[]),...(product.roadside_assistance?['支持道路救援']:[])];
    return {rank:0,product_id:product.product_id,product_name:product.product_name,original_premium:product.annual_premium,premium_after_coupon:afterCoupon,match_score:+score.toFixed(1),score_breakdown:breakdown,recommendation_reasons:reasons};
  }).sort((a,b)=>b.match_score-a.match_score || a.premium_after_coupon-b.premium_after_coupon || a.product_id.localeCompare(b.product_id)).map((item,index)=>({...item,rank:index+1}));
  return {recommended_products:scored.slice(0,3),excluded_products:excluded,fallback_status:scored.length?'none':'no_match'};
}

export async function runRecommendation(need:UserNeed|null,profile:UserProfile,coupon:CouponDecision|null,products:InsuranceProduct[],mode:DecisionMode,llm:LLMProvider):Promise<StageResult<RecommendationResult>> {
  const started=Date.now();
  if (!need || !coupon) return {input:{need,profile,coupon},output:null,decision_summary:['上游输出缺失，推荐节点被阻断'],node_logs:[{node:'recommendation.upstream',status:'failed',summary:'MISSING_UPSTREAM',duration_ms:0}],trace:[{step_id:'recommendation-upstream',stage:'recommendation',kind:'validation',title:'推荐输入门禁',description:'UserNeed 或 CouponDecision 缺失，推荐不可运行。',input:{has_need:Boolean(need),has_coupon:Boolean(coupon)},logic:'need && coupon required',output:{blocked:true},status:'failed',reason_code:'UPSTREAM_MISSING'}],schema_valid:false,retry_count:0,fallback_status:'no_match',error:'UPSTREAM_MISSING'};
  let raw:unknown;
  if(mode==='llm_only'){
    const ranked=await llm.rankProducts(need,products,coupon.discount_value);
    raw={recommended_products:ranked,excluded_products:[],fallback_status:'none'};
  } else raw=rankByRules(need,profile,coupon,products);
  const parsed=recommendationResultSchema.safeParse(raw);
  if(!parsed.success)return {input:{need,profile,coupon},output:null,decision_summary:['推荐输出 Schema 失败'],node_logs:[{node:'recommendation.schema',status:'failed',summary:parsed.error.message,duration_ms:Date.now()-started}],trace:[{step_id:'recommendation-schema',stage:'recommendation',kind:'validation',title:'RecommendationResult Schema 失败',description:'无效排名不会进入产品卡片。',input:{raw},logic:'recommendationResultSchema.safeParse(raw)',output:{issues:parsed.error.issues},status:'failed',reason_code:'RECOMMENDATION_SCHEMA_INVALID'}],schema_valid:false,retry_count:0,fallback_status:'no_match',error:'RECOMMENDATION_SCHEMA_INVALID'};
  const result=parsed.data;
  const trace:DecisionTraceStep[]=[];
  if(mode==='llm_only')trace.push({step_id:'recommendation-llm-only',stage:'recommendation',kind:'llm',title:'LLM 直接排序（对照组）',description:'模型给出结构化列表，但不展示隐藏思维链，也不执行市场、状态、车型和车龄硬过滤。',input:{need,candidate_product_ids:products.map((p)=>p.product_id)},logic:'LLM free ranking → structured list',output:{ranked_product_ids:result.recommended_products.map((x)=>x.product_id)},status:'warning',reason_code:'HARD_FILTER_SKIPPED'});
  else{
    for(const product of products){const reasons=hardReasons(product,profile,coupon);trace.push({step_id:`filter-${product.product_id}`,stage:'recommendation',kind:'filter',title:`硬过滤 ${product.product_id} · ${product.product_name}`,description:'任何硬条件失败都会把产品排除在推荐列表之外。',input:{checks:[{label:'产品在售',actual:product.active,expected:true,pass:product.active},{label:'市场一致',actual:product.market,expected:profile.market,pass:product.market===profile.market},{label:'车型可保',actual:profile.vehicle_type,expected:product.eligible_vehicle_types,pass:product.eligible_vehicle_types.includes(profile.vehicle_type)},{label:'车龄可保',actual:profile.vehicle_age_years,expected:`不超过${product.maximum_vehicle_age_years}年`,pass:profile.vehicle_age_years<=product.maximum_vehicle_age_years},{label:'Voucher适用',actual:coupon.selected_coupon_id,expected:{coupon_products:coupon.eligible_product_ids,product_coupons:product.coupon_ids},pass:coupon.decision!=='grant'||(coupon.eligible_product_ids.includes(product.product_id)&&product.coupon_ids.includes(coupon.selected_coupon_id!))}]},logic:'产品在售 且 市场一致 且 车型可保 且 车龄可保 且 Voucher双向适用',output:{eligible:reasons.length===0,reason_codes:reasons},status:reasons.length?'failed':'passed',reason_code:reasons[0]??'HARD_FILTER_PASSED'});}
    for(const item of result.recommended_products){const product=products.find((p)=>p.product_id===item.product_id)!;const matches=need.coverage_priorities.filter((tag)=>tag==='roadside_assistance'?product.roadside_assistance:product.coverage_tags.includes(tag));trace.push({step_id:`score-${item.product_id}`,stage:'recommendation',kind:'score',title:`量化排序 ${item.product_id} · 第${item.rank}名`,description:'只计算有直接数据依据的保障匹配和优惠后价格；缺失维度不使用默认猜测。',input:{priorities:need.coverage_priorities,matched_priorities:matches,budget_max:need.budget.max_annual_premium,premium_after_coupon:item.premium_after_coupon,weights:rankingWeights},logic:'保障分=60×匹配项/关注项；预算分=40×预算匹配比例；缺失维度重新归一化',output:{score_breakdown:item.score_breakdown,total_score:item.match_score,rank:item.rank,tie_break:'优惠后保费升序 → product_id升序'},status:'passed',reason_code:'QUANTITATIVE_SCORE_CALCULATED'});}
  }
  trace.push({step_id:'recommendation-schema-final',stage:'recommendation',kind:'validation',title:'推荐结果校验',description:'确认排名、得分范围、分项字段和排除原因结构完整。',input:{top_n:3},logic:'recommendationResultSchema.safeParse(result)',output:{valid:true,recommended_count:result.recommended_products.length,excluded_count:result.excluded_products.length},status:result.fallback_status==='no_match'?'warning':'passed',reason_code:result.fallback_status==='no_match'?'NO_MATCH':'RECOMMENDATION_VALID'});
  return {input:{need,profile_snapshot:{user_id:profile.user_id,market:profile.market,vehicle_type:profile.vehicle_type,vehicle_age_years:profile.vehicle_age_years},coupon,ranking_weights:rankingWeights},output:result,decision_summary:[mode==='llm_only'?'LLM直接排序，未执行硬条件过滤（对照组）':`硬过滤排除 ${result.excluded_products.length} 个产品`,`输出 Top-${result.recommended_products.length}，只保留保障与价格两维量化`,result.fallback_status==='no_match'?'无产品通过硬条件，未伪造推荐':'排序完成'],node_logs:[{node:mode==='llm_only'?'recommendation.llm_rank':'recommendation.hard_filter',status:result.fallback_status==='no_match'?'warning':'success',summary:`eligible=${result.recommended_products.length}, excluded=${result.excluded_products.length}`,duration_ms:Date.now()-started},{node:'recommendation.schema',status:'success',summary:'RecommendationResult Schema passed',duration_ms:0}],trace,schema_valid:true,retry_count:0,fallback_status:result.fallback_status};
}
