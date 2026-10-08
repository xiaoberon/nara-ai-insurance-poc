import type { DecisionMode, DecisionTraceStep, StageResult, UserNeed } from '../../shared/types';
import type { LLMProvider } from '../llm/LLMProvider';
import { userNeedSchema } from '../schemas';

function rulesParse(message: string): UserNeed {
  const type: UserNeed['vehicle']['type'] = message.includes('Sedan') ? 'Sedan' : message.includes('SUV') ? 'SUV' : message.includes('Hatchback') ? 'Hatchback' : 'unknown';
  const budget = Number(message.match(/预算(?:最好)?(?:别|不)?超过?\s*([0-9]+)/)?.[1] ?? message.match(/预算\s*([0-9]+)/)?.[1] ?? 0) || null;
  const age = Number(message.match(/车龄\s*([0-9]+)/)?.[1] ?? 0) || null;
  const priorities = ['水浸','盗抢','火灾','道路救援','第三者'].filter((word)=>message.includes(word)).map((word)=>({水浸:'flood',盗抢:'theft',火灾:'fire',道路救援:'roadside_assistance',第三者:'third_party'}[word]!));
  const missing_fields = [...(type==='unknown'?['vehicle.type']:[]),...(age===null?['vehicle.age_years']:[]),...(budget===null?['budget.max_annual_premium']:[])];
  return { intent:message.includes('续保')?'renew_car_insurance':'unknown', vehicle:{type,age_years:age}, budget:{currency:'MYR',max_annual_premium:budget}, coverage_priorities:priorities, usage:message.includes('通勤')||message.includes('上下班')?'daily_commute':message.includes('长途')?'long_distance':'unknown', price_sensitivity:message.includes('便宜')?'high':'unknown', renewal_urgency:message.includes('两周')?'within_2_weeks':message.includes('月底')||message.includes('一个月')?'within_month':'unknown', missing_fields, information_status:missing_fields.length?'needs_clarification':'complete', evidence_summary:priorities.map((x)=>`关键词命中 ${x}`) };
}

export async function runChat(message: string, mode: DecisionMode, llm: LLMProvider, fault?: string): Promise<StageResult<UserNeed>> {
  const started = Date.now();
  const trace:DecisionTraceStep[]=[];
  let retry = 0;
  let raw: unknown;
  let validation;
  try {
    raw = mode === 'rules_only' ? rulesParse(message) : await llm.parseUserNeed(message,{attempt:0,fault});
    validation = userNeedSchema.safeParse(raw);
    if (!validation.success && mode !== 'rules_only') {
      retry = 1;
      trace.push({step_id:'chat-retry-1',stage:'chat',kind:'fallback',title:'结构化输出重试',description:'首次输出没有通过 UserNeed Schema，携带校验失败信息重试一次。',input:{attempt:0,fault:fault??'none'},logic:'if schema_invalid then retry_once',output:{retry_attempt:1},status:'warning',reason_code:'SCHEMA_RETRY'});
      raw = await llm.parseUserNeed(message,{attempt:1,fault});
      validation = userNeedSchema.safeParse(raw);
    }
  } catch (error) {
    retry = 1;
    trace.push({step_id:'chat-timeout-retry',stage:'chat',kind:'fallback',title:'模型调用异常重试',description:'首次模型调用抛出异常，按照策略自动重试一次。',input:{error:String(error)},logic:'on_llm_error → retry_once',output:{retry_attempt:1},status:'warning',reason_code:'LLM_RETRY'});
    try {
      raw = await llm.parseUserNeed(message,{attempt:1,fault});
      validation = userNeedSchema.safeParse(raw);
    } catch (retryError) {
      const fallback = rulesParse(message);
      trace.push({step_id:'chat-rule-fallback',stage:'chat',kind:'fallback',title:'降级为规则解析',description:'模型两次不可用，使用关键词和枚举解析保证链路可继续。',input:{message},logic:'llm_failed_twice → rulesParse(message)',output:{fallback},status:'warning',reason_code:'MOCK_DEGRADED'});
      return { input:{message}, output:fallback, decision_summary:['LLM两次失败，降级为规则解析','高风险发券将被缺字段/置信度门禁阻断'], node_logs:[{node:'chat.parse',status:'warning',summary:String(retryError),duration_ms:Date.now()-started}],trace, schema_valid:true, retry_count:1, fallback_status:'mock_degraded', error:String(error) };
    }
  }
  if (!validation!.success) {
    trace.push({step_id:'chat-schema-failed',stage:'chat',kind:'validation',title:'UserNeed Schema 校验失败',description:'连续两次无效结构不会进入优惠券等下游节点。',input:{raw},logic:'userNeedSchema.safeParse(raw)',output:{issues:validation!.error.issues.map((x)=>({path:x.path.join('.'),message:x.message}))},status:'failed',reason_code:'USER_NEED_SCHEMA_INVALID'});
    return { input:{message}, output:null, decision_summary:['结构化输出连续两次未通过 Schema','阻断下游并进入人工确认'], node_logs:[{node:'chat.schema',status:'failed',summary:validation!.error.issues.map((x)=>x.path.join('.')).join(', '),duration_ms:Date.now()-started}],trace, schema_valid:false, retry_count:retry, fallback_status:'manual_review', error:'USER_NEED_SCHEMA_INVALID' };
  }
  const need = validation!.data;
  const needsClarification = need.information_status==='needs_clarification';
  trace.unshift({step_id:'chat-parse',stage:'chat',kind:mode==='rules_only'?'rule':'llm',title:mode==='rules_only'?'关键词与枚举解析':'语义结构化解析',description:mode==='rules_only'?'使用显式关键词和正则，不包含模型推理。':'展示模型可审计的结构化结果与证据摘要；不展示隐藏思维链。',input:{message,parser:mode==='rules_only'?'rulesParse':llm.name},logic:mode==='rules_only'?'关键词/正则 → 标准字段':'Prompt 模板 + UserNeed Schema → 结构化 JSON',output:{intent:need.intent,vehicle:need.vehicle,budget:need.budget,coverage_priorities:need.coverage_priorities,usage:need.usage,information_status:need.information_status},status:needsClarification?'warning':'passed',evidence:need.evidence_summary});
  trace.push({step_id:'chat-schema',stage:'chat',kind:'validation',title:'UserNeed Schema 校验',description:'检查必填字段、类型、枚举和缺失字段。',input:{required:['intent','vehicle','budget','coverage_priorities','missing_fields','information_status']},logic:'userNeedSchema.safeParse(structured_output)',output:{valid:true,retry_count:retry},status:'passed',reason_code:'USER_NEED_SCHEMA_VALID'});
  trace.push({step_id:'chat-completeness',stage:'chat',kind:'validation',title:'缺失字段与澄清门禁',description:'未明确的信息保持 null/unknown；不使用未经校准的数值置信度。',input:{missing_fields:need.missing_fields,information_status:need.information_status},logic:'information_status == needs_clarification',output:{clarification_required:needsClarification},status:needsClarification?'warning':'passed',reason_code:needsClarification?'CLARIFICATION_REQUIRED':'DOWNSTREAM_READY'});
  return { input:{message}, output:need, decision_summary:[`${mode} 解析得到意图 ${need.intent}`,`识别 ${need.coverage_priorities.length} 个保障偏好`,needsClarification?`需补充：${need.missing_fields.join(', ')}`:'关键信息完整，可进入下游'], node_logs:[{node:'chat.parse',status:needsClarification?'warning':'success',summary:`${llm.name}; ${need.information_status}`,duration_ms:Date.now()-started},{node:'chat.schema',status:'success',summary:'UserNeed Schema passed',duration_ms:0}],trace, schema_valid:true, retry_count:retry, fallback_status:needsClarification?'clarification_required':'none' };
}
