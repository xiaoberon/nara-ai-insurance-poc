import { Agent, request } from 'node:https';
import type { Coupon, InsuranceProduct, PdpDocument, UserNeed, UserProfile } from '../../shared/types';
import { pdpTextFor } from '../services/pdpText';
import type { LLMCallOptions, LLMProvider, LLMUsage } from './LLMProvider';

type JsonSchema=Record<string,unknown>;
type GeminiResponse={candidates?:Array<{content?:{parts?:Array<{text?:string}>}}> ;usageMetadata?:{promptTokenCount?:number;candidatesTokenCount?:number};error?:{message?:string}};
const geminiHttpsAgent=new Agent({keepAlive:true,keepAliveMsecs:10000,maxSockets:1,maxFreeSockets:1});

const string={type:'STRING'};
const number={type:'NUMBER'};
const integer={type:'INTEGER'};
const boolean={type:'BOOLEAN'};
const stringArray={type:'ARRAY',items:string};
const nullable=(schema:JsonSchema)=>({...schema,nullable:true});

const userNeedResponseSchema:JsonSchema={type:'OBJECT',properties:{intent:{type:'STRING',enum:['renew_car_insurance','unknown']},vehicle:{type:'OBJECT',properties:{type:{type:'STRING',enum:['Sedan','SUV','Hatchback','MPV','unknown']},age_years:nullable(integer)},required:['type','age_years']},budget:{type:'OBJECT',properties:{currency:{type:'STRING',enum:['MYR']},max_annual_premium:nullable(number)},required:['currency','max_annual_premium']},coverage_priorities:stringArray,usage:{type:'STRING',enum:['daily_commute','long_distance','occasional','unknown']},price_sensitivity:{type:'STRING',enum:['high','medium','low','unknown']},renewal_urgency:{type:'STRING',enum:['within_2_weeks','within_month','not_urgent','unknown']},missing_fields:stringArray,information_status:{type:'STRING',enum:['complete','needs_clarification']},evidence_summary:stringArray},required:['intent','vehicle','budget','coverage_priorities','usage','price_sensitivity','renewal_urgency','missing_fields','information_status','evidence_summary']};
const couponResponseSchema:JsonSchema={type:'OBJECT',properties:{decision:{type:'STRING',enum:['grant','reject','review']},selected_coupon_id:nullable(string),discount_value:number,currency:{type:'STRING',enum:['MYR']},eligible_product_ids:stringArray,reason_codes:stringArray,rejected_coupon_ids:{type:'ARRAY',items:{type:'OBJECT',properties:{coupon_id:string,reason_code:string},required:['coupon_id','reason_code']}},fallback_status:{type:'STRING',enum:['none','clarification_required','manual_review','mock_degraded']}},required:['decision','selected_coupon_id','discount_value','currency','eligible_product_ids','reason_codes','rejected_coupon_ids','fallback_status']};
const rankedProductsSchema:JsonSchema={type:'ARRAY',items:{type:'OBJECT',properties:{rank:integer,product_id:string,product_name:string,original_premium:number,premium_after_coupon:number,match_score:number,score_breakdown:{type:'OBJECT',properties:{coverage:number,budget:number},required:['coverage','budget']},recommendation_reasons:stringArray},required:['rank','product_id','product_name','original_premium','premium_after_coupon','match_score','score_breakdown','recommendation_reasons']}};
const statedNumber={anyOf:[number,{type:'STRING',enum:['not_stated']}]};
const comparisonResponseSchema:JsonSchema={type:'OBJECT',properties:{products:{type:'ARRAY',items:{type:'OBJECT',properties:{product_id:string,product_name:string,insurer:string,annual_premium:statedNumber,discount_amount:number,premium_after_coupon:statedNumber,sum_insured:statedNumber,coverage:{type:'OBJECT',properties:{collision:string,theft:string,flood:string,fire:string,natural_disaster:string,third_party:string,personal_accident:string},required:['collision','theft','flood','fire','natural_disaster','third_party','personal_accident']},deductible:statedNumber,roadside_assistance:string,term_and_waiting_period:string,exclusions:stringArray,claim_channel_and_documents:string,vehicle_eligibility:string,conflicts:stringArray,evidence:{type:'OBJECT',properties:{premium:string,sum_insured:string,deductible:string},required:['premium','sum_insured','deductible']},match_summary:string},required:['product_id','product_name','insurer','annual_premium','discount_amount','premium_after_coupon','sum_insured','coverage','deductible','roadside_assistance','term_and_waiting_period','exclusions','claim_channel_and_documents','vehicle_eligibility','conflicts','evidence','match_summary']}},requires_manual_review:boolean,fallback_status:{type:'STRING',enum:['none','raw_pdp_only','manual_review']},errors:stringArray},required:['products','requires_manual_review','fallback_status','errors']};

function postJson(url:URL,apiKey:string,body:unknown,timeoutMs:number):Promise<GeminiResponse>{
  return new Promise((resolve,reject)=>{const payload=JSON.stringify(body);const req=request(url,{agent:geminiHttpsAgent,method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload),'x-goog-api-key':apiKey,'Connection':'keep-alive'}},(res)=>{let raw='';res.setEncoding('utf8');res.on('data',(chunk)=>raw+=chunk);res.on('end',()=>{let parsed:GeminiResponse;try{parsed=JSON.parse(raw) as GeminiResponse}catch{reject(new Error(`GEMINI_INVALID_HTTP_RESPONSE_${res.statusCode}`));return}if(!res.statusCode||res.statusCode>=400){reject(new Error(`GEMINI_HTTP_${res.statusCode}: ${parsed.error?.message??'request failed'}`));return}resolve(parsed)})});req.setTimeout(timeoutMs,()=>req.destroy(new Error('GEMINI_TIMEOUT')));req.on('error',reject);req.end(payload)});
}

const sleep=(ms:number)=>new Promise((resolve)=>setTimeout(resolve,ms));
const transientGeminiError=(error:unknown)=>/GEMINI_TIMEOUT|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|socket hang up|Client network socket disconnected before secure TLS connection was established|GEMINI_HTTP_(408|429|500|502|503|504)/i.test(String(error));

export class GeminiLLMProvider implements LLMProvider {
  readonly name:string;
  private usage:LLMUsage={input_tokens:0,output_tokens:0,estimated_cost_usd:0};
  private nextRequestAt=0;
  constructor(private readonly apiKey:string,private readonly model='gemini-3.5-flash-lite',private readonly timeoutMs=60000,private readonly maxRetries=2,private readonly minimumIntervalMs=5000){if(!apiKey)throw new Error('GEMINI_API_KEY_MISSING');this.name=`gemini:${model}`}
  usageSnapshot(){return {...this.usage}}
  private async pace(){const wait=Math.max(0,this.nextRequestAt-Date.now());if(wait)await sleep(wait);this.nextRequestAt=Date.now()+this.minimumIntervalMs}
  private async generate(prompt:string,schema:JsonSchema):Promise<unknown>{
    const url=new URL(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`);
    const body={contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{temperature:0,responseMimeType:'application/json',responseSchema:schema}};
    let response:GeminiResponse|undefined;let lastError:unknown;
    for(let attempt=0;attempt<=this.maxRetries;attempt++){
      try{await this.pace();response=await postJson(url,this.apiKey,body,this.timeoutMs);break}catch(error){lastError=error;if(attempt===this.maxRetries||!transientGeminiError(error))throw error;const backoff=/GEMINI_HTTP_429/.test(String(error))?65000:1000*(2**attempt)+Math.floor(Math.random()*400);process.stderr.write(`Gemini临时异常，第${attempt+1}次重试将在${backoff}ms后进行：${String(error)}\n`);await sleep(backoff)}
    }
    if(!response)throw lastError;
    this.usage.input_tokens+=response.usageMetadata?.promptTokenCount??0;this.usage.output_tokens+=response.usageMetadata?.candidatesTokenCount??0;
    const text=response.candidates?.[0]?.content?.parts?.map((part)=>part.text??'').join('');if(!text)throw new Error('GEMINI_EMPTY_RESPONSE');
    try{return JSON.parse(text)}catch{throw new Error('GEMINI_INVALID_JSON')}
  }
  parseUserNeed(message:string,_options:LLMCallOptions={}):Promise<unknown>{return this.generate(`你是车险需求结构化节点。只根据用户原话抽取，不猜测缺失值。\n规则：\n- 车龄与预算没有明确数字时填 null。\n- 两个冲突预算都出现时预算填 null，并把 budget.conflict_requires_confirmation 加入 missing_fields。\n- coverage_priorities 只能使用 flood、theft、fire、roadside_assistance、third_party、personal_accident。\n- 缺车型、车龄或预算时列入 missing_fields；存在任何缺失项时 information_status=needs_clarification。\n- evidence_summary 只写用户原话可支持的简短摘要。\n用户输入：${JSON.stringify(message)}`,userNeedResponseSchema)}
  chooseCoupon(need:UserNeed,profile:UserProfile,coupons:Coupon[]):Promise<unknown>{const safeProfile={user_id:profile.user_id,market:profile.market,segment:profile.segment,renewal_due_days:profile.renewal_due_days,price_sensitivity:profile.price_sensitivity,coupon_received_30d:profile.coupon_received_30d};const candidates=coupons.map(({coupon_id,name,discount_value,currency,minimum_premium,eligible_product_ids,stackable})=>({coupon_id,name,discount_value,currency,minimum_premium,eligible_product_ids,stackable}));return this.generate(`你是Voucher候选排序节点。从提供的候选券中选择最符合用户需求的一张；如果候选数组为空则 reject。不得修改券ID、金额或适用产品。返回完整CouponDecision。reason_codes写 LLM_PREFERENCE_RANKED。\n用户需求：${JSON.stringify(need)}\n脱敏画像：${JSON.stringify(safeProfile)}\n候选券：${JSON.stringify(candidates)}`,couponResponseSchema)}
  rankProducts(need:UserNeed,products:InsuranceProduct[],discount:number):Promise<unknown>{return this.generate(`你是LLM Only产品排序对照组。根据用户需求对所有候选排序，返回每个产品且不自行新增产品。match_score为0到100；score_breakdown只有coverage和budget，二者合计等于match_score。\n用户需求：${JSON.stringify(need)}\n折扣：${discount}\n产品定义：${JSON.stringify(products)}`,rankedProductsSchema)}
  async compareProducts(products:InsuranceProduct[],pdps:PdpDocument[],discount:number,_options:LLMCallOptions={}):Promise<unknown>{const sources=products.map((product)=>({product_id:product.product_id,product_name:product.product_name,insurer:product.insurer,pdp_text:pdpTextFor(product.product_id,pdps)}));const raw=await this.generate(`你是PDP横向比较抽取节点。只能从每个产品自己的pdp_text抽取，不得使用常识或产品定义补齐。\n规则：\n- 所有保险保障统一放在coverage中，包括third_party和personal_accident。\n- 未明确披露的字段必须写字符串 not_stated。\n- coverage各字段只能写 covered或not_stated；roadside_assistance只能写 included或not_stated。\n- 否定表述如“未提及水浸”“未披露水浸”必须归一为 not_stated，不能写 covered。\n- 同一字段出现不同数值时该字段写 not_stated，在 conflicts 中记录 field: values conflict，并设置 requires_manual_review=true。\n- evidence中的每个非not_stated值必须逐字复制同一PDP中的完整短句，禁止改写。\n- 数值字段只返回数字或not_stated。未披露字段清单由后端自动生成，模型无需输出。\nPDP来源：${JSON.stringify(sources)}`,comparisonResponseSchema) as {products?:Array<Record<string,unknown>>};
    // Discount is an authoritative rule output, not a field the model may invent.
    if(Array.isArray(raw.products))for(const item of raw.products){item.discount_amount=discount;item.premium_after_coupon=typeof item.annual_premium==='number'?Math.max(0,item.annual_premium-discount):'not_stated'}
    return raw;
  }
}
