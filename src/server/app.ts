import express from 'express';
import cors from 'cors';
import { existsSync,readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { coupons,pdps,productContents,products,userVouchers,users,voucherInstances } from './data/catalog';
import { dataDictionary } from './data/dictionary';
import { testCases } from './data/testCases';
import { llmProvider } from './llm/provider';
import { runChat } from './services/chatService';
import { runCoupon } from './services/couponEngine';
import { runRecommendation } from './services/productMatcher';
import { runComparison } from './services/comparisonExtractor';
import { runFull } from './services/runService';
import { compareModes } from './services/evaluationService';
import type { DecisionMode } from '../shared/types';

const llm=llmProvider;
export const app=express();
app.use(cors());app.use(express.json({limit:'1mb'}));
let evaluationRunning=false;

const mode=(value:unknown):DecisionMode=>value==='rules_only'||value==='llm_only'?value:'hybrid';
app.get('/api/health',(_req,res)=>res.json({ok:true,provider:llm.name,data_policy:'fictional-only'}));
app.get('/api/cases',(_req,res)=>res.json({cases:testCases,users,products,llm_provider:llm.name}));
app.get('/api/data/catalog',(_req,res)=>res.json({users,voucher_batches:coupons,voucher_instances:voucherInstances,user_vouchers:userVouchers,product_definitions:products,product_cards:productContents,pdp_pages:pdps,dictionary:dataDictionary,summary:{users:users.length,vehicles:users.reduce((n,x)=>n+x.vehicles.length,0),policies:users.reduce((n,x)=>n+x.policies.length,0),voucher_batches:coupons.length,voucher_instances:voucherInstances.length,user_vouchers:userVouchers.length,product_definitions:products.length,product_cards:productContents.length,pdp_pages:pdps.length,data_policy:'fictional and masked'}}));
app.get('/api/products/:productId/pdp',(req,res)=>{const definition=products.find((x)=>x.product_id===req.params.productId);const content=productContents.find((x)=>x.product_id===req.params.productId);const page=pdps.find((x)=>x.product_id===req.params.productId);if(!definition||!content||!page)return res.status(404).json({error:'PRODUCT_OR_PDP_NOT_FOUND'});return res.json({product_id:req.params.productId,product_name:definition.product_name,pdp_id:page.pdp_id,route:page.route,cms_version:page.cms_version,content_type:page.content_type,html:page.html,card:content.card});});
app.post('/api/chat/parse',async(req,res,next)=>{try{res.json(await runChat(req.body.message,mode(req.body.mode),llm,req.body.mock_fault));}catch(e){next(e);}});
app.post('/api/coupon/decide',async(req,res,next)=>{try{const profile=users.find((x)=>x.user_id===req.body.profile_id);if(!profile)throw new Error('PROFILE_NOT_FOUND');res.json(await runCoupon(req.body.need,profile,coupons,products,mode(req.body.mode),llm));}catch(e){next(e);}});
app.post('/api/product/recommend',async(req,res,next)=>{try{const profile=users.find((x)=>x.user_id===req.body.profile_id);if(!profile)throw new Error('PROFILE_NOT_FOUND');res.json(await runRecommendation(req.body.need,profile,req.body.coupon,products,mode(req.body.mode),llm));}catch(e){next(e);}});
app.post('/api/product/compare',async(req,res,next)=>{try{res.json(await runComparison(req.body.need,req.body.selected_product_ids,products,pdps,req.body.discount??0,mode(req.body.mode),llm));}catch(e){next(e);}});
app.post('/api/run/full',async(req,res,next)=>{try{const testCase=testCases.find((x)=>x.id===req.body.case_id)??testCases[0];res.json(await runFull({case:testCase,mode:mode(req.body.mode),message:req.body.message,profile_id:req.body.profile_id,selected_product_ids:req.body.selected_product_ids}));}catch(e){next(e);}});
app.post('/api/evaluation/compare-modes',async(req,res,next)=>{
  if(evaluationRunning)return res.status(409).json({error:'已有一项批量评估正在运行，请等待完成或重启后端取消旧任务。',fallback_status:'evaluation_already_running'});
  evaluationRunning=true;
  try{const scope=req.body.scope==='current'||req.body.scope==='typical'?req.body.scope:'all';res.json(await compareModes(Math.min(5,Math.max(1,Number(req.body.repeats??1))),scope,req.body.case_id));}
  catch(e){next(e)}finally{evaluationRunning=false}
});
app.get('/api/runs/:runId',(req,res)=>{const file=resolve(process.cwd(),'logs','runs.jsonl');if(!existsSync(file))return res.status(404).json({error:'RUN_NOT_FOUND'});const match=readFileSync(file,'utf8').trim().split('\n').reverse().map((line)=>JSON.parse(line)).find((run)=>run.audit?.run_id===req.params.runId);return match?res.json(match):res.status(404).json({error:'RUN_NOT_FOUND'});});
app.use((error:Error,_req:express.Request,res:express.Response,_next:express.NextFunction)=>res.status(400).json({error:error.message,fallback_status:'request_rejected'}));
