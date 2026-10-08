import type { ComparisonItem, DecisionMode, FullRunResult, InsuranceProduct, TestCase } from '../../shared/types';
import { pdps, products, users } from '../data/catalog';
import { evaluationExpectations, type CaseEvaluationExpectation } from '../data/evaluationExpectations';
import { testCases } from '../data/testCases';
import { llmProvider } from '../llm/provider';
import { runFull } from './runService';
import { pdpTextFor } from './pdpText';

type StageKey='chat'|'voucher'|'recommendation'|'comparison';
interface Assessment { pass:boolean; mismatches:string[]; hard_violations:number; ungrounded_fields:number }
interface CaseAccumulator {case_id:string;case_name:string;profile_id:string;typical:boolean;expected:CaseEvaluationExpectation;modes:Record<DecisionMode,{runs:number;passes:Record<StageKey,number>;full_passes:number;mismatches:Set<string>;sample_actual:unknown}>}
export interface ModeMetrics {mode:DecisionMode;runs:number;chat_pass_rate:number;voucher_pass_rate:number;recommendation_pass_rate:number;comparison_pass_rate:number;full_chain_pass_rate:number;hard_condition_violations:number;ungrounded_pdp_fields:number;provider_fallback_runs:number;repeat_consistency:number;schema_pass_rate:number;average_latency_ms:number;input_tokens:number;output_tokens:number;estimated_cost_usd:number}

const modes:DecisionMode[]=['hybrid','rules_only','llm_only'];
const typicalCaseIds=['C01','C07','C11','C12','C16'];
export type EvaluationScope='current'|'typical'|'all';
const round=(n:number)=>+n.toFixed(3);
const stable=(run:FullRunResult)=>JSON.stringify({chat:run.stages.chat.output,coupon:run.stages.coupon.output,recommendation:run.stages.recommendation.output,comparison:run.stages.comparison.output});
const emptyAssessment=():Assessment=>({pass:true,mismatches:[],hard_violations:0,ungrounded_fields:0});
const fail=(a:Assessment,message:string)=>{a.pass=false;a.mismatches.push(message)};
const normalCoverage=(value:string)=>value==='roadside'?'roadside_assistance':value;
const usedProviderFallback=(run:FullRunResult)=>JSON.stringify(run.stages).includes('PROVIDER_FALLBACK_TO_MOCK');

function assessChat(run:FullRunResult,expected:CaseEvaluationExpectation['chat']):Assessment{
  const result=emptyAssessment();const actual=run.stages.chat.output;
  if(!actual){fail(result,'Chat：没有产生结构化输出');return result}
  if(actual.intent!==expected.intent)fail(result,`Chat意图：预期 ${expected.intent}，实际 ${actual.intent}`);
  if(actual.information_status!==expected.information_status)fail(result,`信息状态：预期 ${expected.information_status}，实际 ${actual.information_status}`);
  if(expected.vehicle_type!==undefined&&actual.vehicle.type!==expected.vehicle_type)fail(result,`车型：预期 ${expected.vehicle_type}，实际 ${actual.vehicle.type}`);
  if(expected.vehicle_age_years!==undefined&&actual.vehicle.age_years!==expected.vehicle_age_years)fail(result,`车龄：预期 ${expected.vehicle_age_years}，实际 ${actual.vehicle.age_years}`);
  if(expected.max_annual_premium!==undefined&&actual.budget.max_annual_premium!==expected.max_annual_premium)fail(result,`预算：预期 ${expected.max_annual_premium}，实际 ${actual.budget.max_annual_premium}`);
  for(const coverage of expected.must_include_coverage??[])if(!actual.coverage_priorities.map(normalCoverage).includes(normalCoverage(coverage)))fail(result,`需求遗漏保障：${coverage}`);
  for(const field of expected.must_report_missing??[])if(!actual.missing_fields.includes(field))fail(result,`应报告缺失字段：${field}`);
  return result;
}

function assessVoucher(run:FullRunResult,expected:CaseEvaluationExpectation['voucher']):Assessment{
  const result=emptyAssessment();const actual=run.stages.coupon.output;
  if(!actual){fail(result,'Voucher：没有产生决策');return result}
  if(actual.decision!==expected.decision)fail(result,`发券结论：预期 ${expected.decision}，实际 ${actual.decision}`);
  if(expected.selected_coupon_id&&actual.selected_coupon_id!==expected.selected_coupon_id)fail(result,`选券：预期 ${expected.selected_coupon_id}，实际 ${actual.selected_coupon_id??'无'}`);
  if(expected.required_reason){const reasons=[...actual.reason_codes,...actual.rejected_coupon_ids.map((item)=>item.reason_code)];if(!reasons.includes(expected.required_reason))fail(result,`拒绝原因应包含 ${expected.required_reason}`)}
  return result;
}

function productCovers(product:InsuranceProduct,coverage:string){const normalized=normalCoverage(coverage);return normalized==='roadside_assistance'?product.roadside_assistance:product.coverage_tags.includes(normalized)}
function assessRecommendation(run:FullRunResult,testCase:TestCase,expected:CaseEvaluationExpectation['recommendation']):Assessment{
  const result=emptyAssessment();const output=run.stages.recommendation.output;const profile=users.find((item)=>item.user_id===testCase.profile_id)!;const need=run.stages.chat.output;
  if(!output){fail(result,'推荐：没有产生输出');return result}
  const ids=output.recommended_products.map((item)=>item.product_id);const top=products.find((item)=>item.product_id===ids[0]);
  if(expected.acceptable_top1.length===0){if(ids.length)fail(result,`该场景应无可推荐产品，实际首位 ${ids[0]}`)}else if(!ids[0]||!expected.acceptable_top1.includes(ids[0]))fail(result,`推荐首位：可接受 ${expected.acceptable_top1.join('/')}，实际 ${ids[0]??'无'}`);
  for(const id of expected.must_exclude??[])if(ids.includes(id))fail(result,`不应推荐硬条件不符产品 ${id}`);
  if(top)for(const coverage of expected.must_cover??[])if(!productCovers(top,coverage))fail(result,`首位产品 ${top.product_id} 未覆盖 ${coverage}`);
  if(top&&expected.must_be_within_budget&&need?.budget.max_annual_premium!==null){const shown=output.recommended_products[0].premium_after_coupon;if(shown>need!.budget.max_annual_premium!)fail(result,`首位产品优惠后 ${shown} 超过预算 ${need!.budget.max_annual_premium}`)}
  for(const item of output.recommended_products){const product=products.find((x)=>x.product_id===item.product_id);if(!product)continue;const couponScope=run.stages.coupon.output?.decision==='grant'?run.stages.coupon.output.eligible_product_ids:null;const violations=[!product.active,product.market!==profile.market,!product.eligible_vehicle_types.includes(profile.vehicle_type),profile.vehicle_age_years>product.maximum_vehicle_age_years,Boolean(couponScope&&!couponScope.includes(product.product_id))].filter(Boolean).length;if(violations){result.hard_violations+=violations;fail(result,`${product.product_id} 违反 ${violations} 项硬条件`)}}
  return result;
}

function comparisonValue(item:ComparisonItem,field:string):unknown{if(field in item.coverage)return item.coverage[field];return (item as unknown as Record<string,unknown>)[field]}
function assessComparison(run:FullRunResult,expected:CaseEvaluationExpectation['comparison']):Assessment{
  const result=emptyAssessment();const output=run.stages.comparison.output;
  if(!output){fail(result,'比较：没有产生经过校验的结构化输出');return result}
  for(const [path,wanted] of Object.entries(expected.assertions)){const [productId,field]=path.split('.');const item=output.products.find((x)=>x.product_id===productId);if(!item){fail(result,`比较缺少产品 ${productId}`);continue}const actual=comparisonValue(item,field);if(actual!==wanted)fail(result,`${path}：预期 ${wanted}，实际 ${String(actual)}`)}
  if(output.requires_manual_review!==expected.requires_manual_review)fail(result,`人工核对：预期 ${expected.requires_manual_review?'需要':'不需要'}，实际 ${output.requires_manual_review?'需要':'不需要'}`);
  if(expected.required_conflict){const [productId,field]=expected.required_conflict.split('.');const item=output.products.find((x)=>x.product_id===productId);if(!item?.conflicts.some((x)=>x.includes(field)))fail(result,`应识别字段冲突 ${expected.required_conflict}`)}
  for(const item of output.products){const source=pdpTextFor(item.product_id,pdps);for(const [field,evidence] of Object.entries(item.evidence)){if(evidence!=='not_stated'&&!source.includes(evidence)){result.ungrounded_fields++;fail(result,`${item.product_id}.${field} 的证据无法在 PDP 找到`)}}}
  return result;
}

function summarizeActual(run:FullRunResult){return {chat:{intent:run.stages.chat.output?.intent??null,information_status:run.stages.chat.output?.information_status??null,vehicle:run.stages.chat.output?.vehicle??null,budget:run.stages.chat.output?.budget??null,coverage_priorities:run.stages.chat.output?.coverage_priorities??[],missing_fields:run.stages.chat.output?.missing_fields??[]},voucher:{decision:run.stages.coupon.output?.decision??null,selected_coupon_id:run.stages.coupon.output?.selected_coupon_id??null,reason_codes:run.stages.coupon.output?.reason_codes??[]},recommendation:{product_ids:run.stages.recommendation.output?.recommended_products.map((x)=>x.product_id)??[]},comparison:{products:run.stages.comparison.output?.products.map((x)=>({product_id:x.product_id,annual_premium:x.annual_premium,deductible:x.deductible,coverage:x.coverage,roadside_assistance:x.roadside_assistance,not_stated_fields:x.not_stated_fields,conflicts:x.conflicts}))??[],requires_manual_review:run.stages.comparison.output?.requires_manual_review??null}}}

export async function compareModes(repeats=1,scope:EvaluationScope='all',currentCaseId='C01'){
  const selectedCases=scope==='current'?testCases.filter((item)=>item.id===currentCaseId):scope==='typical'?testCases.filter((item)=>typicalCaseIds.includes(item.id)):testCases;
  if(!selectedCases.length)throw new Error('EVALUATION_CASE_NOT_FOUND');
  const caseAccumulators:CaseAccumulator[]=selectedCases.map((item)=>({case_id:item.id,case_name:item.name,profile_id:item.profile_id,typical:typicalCaseIds.includes(item.id),expected:evaluationExpectations[item.id],modes:Object.fromEntries(modes.map((mode)=>[mode,{runs:0,passes:{chat:0,voucher:0,recommendation:0,comparison:0},full_passes:0,mismatches:new Set<string>(),sample_actual:null}])) as CaseAccumulator['modes']}));
  const metrics:ModeMetrics[]=[];
  for(const mode of modes){let runs=0,chatPass=0,voucherPass=0,recommendationPass=0,comparisonPass=0,fullPass=0,hardViolations=0,ungrounded=0,providerFallbackRuns=0,schemaPassed=0,totalMs=0,inputTokens=0,outputTokens=0,cost=0,consistentCases=0;
    for(const testCase of selectedCases){const expected=evaluationExpectations[testCase.id];const row=caseAccumulators.find((x)=>x.case_id===testCase.id)!.modes[mode];const repeated:FullRunResult[]=[];
      for(let i=0;i<repeats;i++){const run=await runFull({case:testCase,mode,persist:false});repeated.push(run);runs++;row.runs++;if(i===0)row.sample_actual=summarizeActual(run);
        const chat=assessChat(run,expected.chat);const voucher=assessVoucher(run,expected.voucher);const recommendation=assessRecommendation(run,testCase,expected.recommendation);const comparison=assessComparison(run,expected.comparison);const assessments={chat,voucher,recommendation,comparison};
        for(const [stage,assessment] of Object.entries(assessments) as Array<[StageKey,Assessment]>){if(assessment.pass){row.passes[stage]++;if(stage==='chat')chatPass++;if(stage==='voucher')voucherPass++;if(stage==='recommendation')recommendationPass++;if(stage==='comparison')comparisonPass++}assessment.mismatches.forEach((message)=>row.mismatches.add(message));hardViolations+=assessment.hard_violations;ungrounded+=assessment.ungrounded_fields}
        if(Object.values(assessments).every((item)=>item.pass)){fullPass++;row.full_passes++}
        if(usedProviderFallback(run))providerFallbackRuns++;schemaPassed+=Object.values(run.stages).filter((stage)=>stage.schema_valid).length;totalMs+=run.audit.total_duration_ms;inputTokens+=run.audit.input_tokens;outputTokens+=run.audit.output_tokens;cost+=run.audit.estimated_cost_usd;
      }
      if(new Set(repeated.map(stable)).size===1)consistentCases++;
    }
    metrics.push({mode,runs,chat_pass_rate:round(chatPass/runs),voucher_pass_rate:round(voucherPass/runs),recommendation_pass_rate:round(recommendationPass/runs),comparison_pass_rate:round(comparisonPass/runs),full_chain_pass_rate:round(fullPass/runs),hard_condition_violations:hardViolations,ungrounded_pdp_fields:ungrounded,provider_fallback_runs:providerFallbackRuns,repeat_consistency:round(consistentCases/selectedCases.length),schema_pass_rate:round(schemaPassed/(runs*4)),average_latency_ms:round(totalMs/runs),input_tokens:inputTokens,output_tokens:outputTokens,estimated_cost_usd:round(cost)});
  }
  const providerFallbackRuns=metrics.reduce((sum,item)=>sum+item.provider_fallback_runs,0);
  return {evaluation_version:'v5-four-stage',generated_at:new Date().toISOString(),llm_provider:llmProvider.name,real_llm_result_valid:providerFallbackRuns===0,provider_fallback_runs:providerFallbackRuns,scope,repeats_per_case:repeats,test_case_count:selectedCases.length,profile_count:new Set(selectedCases.map((item)=>item.profile_id)).size,execution_count:selectedCases.length*modes.length*repeats,note:'结果由本次运行的实际输出逐项对照可见标准答案计算，不预填模式优劣；no superiority values are prefilled. 发生Mock回退时整批仍可导出，但不可作为纯真实LLM评估结论。',metric_definition:{chat:'意图、信息状态及案例关键字段全部符合即通过',voucher:'发/拒结论、券ID及关键拒绝原因符合即通过',recommendation:'首位产品落在可接受集合且无硬条件违规即通过',comparison:'关键PDP字段、冲突与人工核对状态符合即通过',full_chain:'同一次运行四阶段全部通过',safety_red_lines:['推荐硬条件违规数','PDP无来源字段数','Provider回退运行数']},modes:metrics,case_results:caseAccumulators.map((item)=>({...item,modes:Object.fromEntries(modes.map((mode)=>{const value=item.modes[mode];return[mode,{runs:value.runs,chat_pass_rate:round(value.passes.chat/value.runs),voucher_pass_rate:round(value.passes.voucher/value.runs),recommendation_pass_rate:round(value.passes.recommendation/value.runs),comparison_pass_rate:round(value.passes.comparison/value.runs),full_chain_pass_rate:round(value.full_passes/value.runs),mismatches:[...value.mismatches],sample_actual:value.sample_actual}]}))}))};
}

