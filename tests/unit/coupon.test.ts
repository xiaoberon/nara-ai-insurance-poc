import { describe, expect, it } from 'vitest';
import { coupons, products, users } from '../../src/server/data/catalog';
import { MockLLMProvider } from '../../src/server/llm/MockLLMProvider';
import { runChat } from '../../src/server/services/chatService';
import { runCoupon } from '../../src/server/services/couponEngine';

const llm=new MockLLMProvider();
const need=async()=> (await runChat('Sedan车龄3年，两周内续保，预算900，担心水浸。','hybrid',llm)).output!;

describe('Coupon stage',()=>{
  it('grants deterministically after all hard checks',async()=>{
    const result=await runCoupon(await need(),users[0],coupons,products,'hybrid',llm);
    expect(result.output?.decision).toBe('grant');
    expect(result.output?.selected_coupon_id).toBe('CPN-RENEW-50');
    expect(result.output?.discount_value).toBe(50);
    expect(result.trace.filter((x)=>x.kind==='rule')).toHaveLength(coupons.length);
    expect(result.trace.find((x)=>x.step_id==='coupon-CPN-RENEW-50')?.output).toMatchObject({eligible:true});
  });

  it('lets Hybrid LLM see only rule-eligible vouchers',async()=>{
    const seen:string[][]=[];
    const provider=new MockLLMProvider();
    const choose=provider.chooseCoupon.bind(provider);
    provider.chooseCoupon=async(userNeed,profile,candidates)=>{seen.push(candidates.map((x)=>x.coupon_id));return choose(userNeed,profile,candidates);};
    const result=await runCoupon(await need(),users[0],coupons,products,'hybrid',provider);
    expect(seen).toEqual([['CPN-RENEW-50']]);
    expect(result.trace.find((x)=>x.step_id==='coupon-llm-rank')?.input).toMatchObject({eligible_batches:['CPN-RENEW-50']});
  });

  it('blocks frequency-limited users despite LLM suggestion',async()=>{
    const result=await runCoupon(await need(),users[1],coupons,products,'hybrid',llm);
    expect(result.output?.decision).toBe('reject');
    expect(result.output?.rejected_coupon_ids.some((x)=>x.reason_code==='FREQUENCY_LIMIT_REACHED')).toBe(true);
    expect(result.decision_summary.join(' ')).toContain('合资格券 0 张');
    expect(result.trace.find((x)=>x.step_id==='coupon-CPN-RENEW-50')?.reason_code).toBe('FREQUENCY_LIMIT_REACHED');
  });

  it('blocks high-risk grant on missing upstream fields',async()=>{
    const incomplete=(await runChat('帮我续保。','hybrid',llm)).output!;
    const result=await runCoupon(incomplete,users[0],coupons,products,'hybrid',llm);
    expect(result.output?.decision).toBe('reject');
    expect(result.output?.reason_codes).toContain('HIGH_RISK_COUPON_BLOCKED');
  });

  it('sends invalid rule configuration to manual review',async()=>{
    const broken=[{...coupons[0],discount_value:80,maximum_discount:50}];
    const result=await runCoupon(await need(),users[0],broken,products,'hybrid',llm);
    expect(result.output?.decision).toBe('review');
    expect(result.fallback_status).toBe('manual_review');
  });

  it('keeps llm-only as an intentionally unsafe comparison path',async()=>{
    const result=await runCoupon(await need(),users[2],coupons,products,'llm_only',llm);
    expect(result.output?.selected_coupon_id).toBe('CPN-VIP-100');
    expect(result.output?.discount_value).toBe(100);
  });

  it('can reject a frequency-limited VIP main voucher but grant an eligible stackable add-on batch',async()=>{
    const vipNeed=(await runChat('MPV车龄5年，一周内续保，预算1200，要水浸和道路救援。','hybrid',llm)).output!;
    const result=await runCoupon(vipNeed,users[4],coupons,products,'hybrid',llm);
    expect(result.output?.selected_coupon_id).toBe('CPN-STACK-20');
    expect(result.output?.rejected_coupon_ids).toContainEqual({coupon_id:'CPN-VIP-100',reason_code:'FREQUENCY_LIMIT_REACHED'});
  });
});
