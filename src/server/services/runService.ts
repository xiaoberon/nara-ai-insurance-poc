import type { DecisionMode, FullRunResult, RecommendedProduct, StageResult, TestCase } from '../../shared/types';
import { coupons, pdps, products, users } from '../data/catalog';
import { estimateMockUsage } from '../llm/LLMProvider';
import { llmProvider } from '../llm/provider';
import { runChat } from './chatService';
import { runCoupon } from './couponEngine';
import { runRecommendation } from './productMatcher';
import { runComparison } from './comparisonExtractor';

const llm=llmProvider;
const emptyStage=<T>(name:string,error:string):StageResult<T>=>({input:null,output:null,decision_summary:[`${name} 未运行：${error}`],node_logs:[{node:name,status:'failed',summary:error,duration_ms:0}],trace:[{step_id:`${name}-blocked`,stage:name as 'coupon'|'recommendation'|'comparison',kind:'fallback',title:`${name} 被上游阻断`,description:'上游没有产生可用且经过校验的输出。',input:{error},logic:'upstream_invalid → do_not_run',output:{blocked:true},status:'failed',reason_code:error}],schema_valid:false,retry_count:0,fallback_status:'blocked',error});

export interface FullRunInput { case:TestCase; mode:DecisionMode; message?:string; profile_id?:string; selected_product_ids?:string[]; persist?:boolean }

export async function runFull(input:FullRunInput):Promise<FullRunResult>{
  const started=Date.now();
  const usageBefore=llm.usageSnapshot?.();
  const runId=crypto.randomUUID();
  const profile=users.find((user)=>user.user_id===(input.profile_id??input.case.profile_id));
  if(!profile)throw new Error('PROFILE_NOT_FOUND');
  const message=input.message??input.case.message;
  const chat=await runChat(message,input.mode,llm,input.case.mock_fault);
  const coupon=chat.output?await runCoupon(chat.output,profile,coupons,products,input.mode,llm):emptyStage<any>('coupon','CHAT_BLOCKED');
  const recommendation=chat.output&&coupon.output?await runRecommendation(chat.output,profile,coupon.output,products,input.mode,llm):emptyStage<any>('recommendation','UPSTREAM_BLOCKED');
  const selected=input.selected_product_ids??input.case.selected_product_ids??recommendation.output?.recommended_products.slice(0,2).map((item:RecommendedProduct)=>item.product_id)??[];
  const comparison=chat.output?await runComparison(chat.output,selected,products,pdps,coupon.output?.discount_value??0,input.mode,llm):emptyStage<any>('comparison','CHAT_BLOCKED');
  const usageAfter=llm.usageSnapshot?.();
  const measuredUsage=usageBefore&&usageAfter?{input_tokens:Math.max(0,usageAfter.input_tokens-usageBefore.input_tokens),output_tokens:Math.max(0,usageAfter.output_tokens-usageBefore.output_tokens),estimated_cost_usd:Math.max(0,usageAfter.estimated_cost_usd-usageBefore.estimated_cost_usd)}:null;
  const usage=input.mode==='rules_only'?{input_tokens:0,output_tokens:0,estimated_cost_usd:0}:measuredUsage??estimateMockUsage({message,profile}, {chat:chat.output,coupon:coupon.output,recommendation:recommendation.output,comparison:comparison.output});
  const stages={chat,coupon,recommendation,comparison};
  const result:FullRunResult={audit:{run_id:runId,timestamp:new Date().toISOString(),mode:input.mode,model:input.mode==='rules_only'?'none':llm.name,model_config:`temperature=0; provider=${llm.name}`,total_duration_ms:Date.now()-started,...usage,schema_valid:Object.values(stages).every((stage)=>stage.schema_valid),retry_count:Object.values(stages).reduce((sum,stage)=>sum+stage.retry_count,0),manual_review:Object.values(stages).some((stage)=>stage.fallback_status==='manual_review')},stages};
  // The hosted portfolio demo intentionally keeps no visitor prompts or run
  // records. Local evaluation can still call this function with persist:false.
  return result;
}
