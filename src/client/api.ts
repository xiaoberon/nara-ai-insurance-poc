import type { DataDictionary, DecisionMode, FullRunResult, StageResult, TestCase, UserProfile, InsuranceProduct, ProductContent, Coupon, PdpDocument, UserVoucher, VoucherInstance } from '../shared/types';
import { coupons, pdps, productContents, products, users, userVouchers, voucherInstances } from '../server/data/catalog';
import { dataDictionary } from '../server/data/dictionary';
import { testCases } from '../server/data/testCases';
import { llmProvider } from '../server/llm/provider';
import { runChat } from '../server/services/chatService';
import { runCoupon } from '../server/services/couponEngine';
import { runRecommendation } from '../server/services/productMatcher';
import { runComparison } from '../server/services/comparisonExtractor';
import { runFull } from '../server/services/runService';
import { compareModes } from '../server/services/evaluationService';

export interface BootstrapData {cases:TestCase[];users:UserProfile[];products:InsuranceProduct[];llm_provider:string}
export interface CatalogData {users:UserProfile[];voucher_batches:Coupon[];voucher_instances:VoucherInstance[];user_vouchers:UserVoucher[];product_definitions:InsuranceProduct[];product_cards:ProductContent[];pdp_pages:PdpDocument[];dictionary:DataDictionary;summary:Record<string,number|string>}
const mode=(value:unknown):DecisionMode=>value==='rules_only'||value==='llm_only'?value:'hybrid';
export const api={
  bootstrap:async():Promise<BootstrapData>=>({cases:testCases,users,products,llm_provider:llmProvider.name}),
  catalog:async():Promise<CatalogData>=>({users,voucher_batches:coupons,voucher_instances:voucherInstances,user_vouchers:userVouchers,product_definitions:products,product_cards:productContents,pdp_pages:pdps,dictionary:dataDictionary,summary:{users:users.length,vehicles:users.reduce((n,x)=>n+x.vehicles.length,0),policies:users.reduce((n,x)=>n+x.policies.length,0),voucher_batches:coupons.length,voucher_instances:voucherInstances.length,user_vouchers:userVouchers.length,product_definitions:products.length,product_cards:productContents.length,pdp_pages:pdps.length,data_policy:'fictional and masked'}}),
  fullRun:async(payload:any):Promise<FullRunResult>=>{const testCase=testCases.find(x=>x.id===payload.case_id)??testCases[0];return runFull({case:testCase,mode:mode(payload.mode),message:payload.message,profile_id:payload.profile_id,selected_product_ids:payload.selected_product_ids,persist:false});},
  chat:async(payload:any):Promise<StageResult<any>>=>runChat(payload.message,mode(payload.mode),llmProvider,payload.mock_fault),
  coupon:async(payload:any):Promise<StageResult<any>>=>{const profile=users.find(x=>x.user_id===payload.profile_id);if(!profile)throw new Error('PROFILE_NOT_FOUND');return runCoupon(payload.need,profile,coupons,products,mode(payload.mode),llmProvider);},
  recommendation:async(payload:any):Promise<StageResult<any>>=>{const profile=users.find(x=>x.user_id===payload.profile_id);if(!profile)throw new Error('PROFILE_NOT_FOUND');return runRecommendation(payload.need,profile,payload.coupon,products,mode(payload.mode),llmProvider);},
  comparison:async(payload:any):Promise<StageResult<any>>=>runComparison(payload.need,payload.selected_product_ids,products,pdps,payload.discount??0,mode(payload.mode),llmProvider),
  evaluation:(repeats=5,scope:'typical'|'all'='typical',caseId='C01')=>compareModes(repeats,scope,caseId)
};
export type { DecisionMode };
