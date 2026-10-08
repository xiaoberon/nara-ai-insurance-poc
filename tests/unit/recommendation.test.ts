import { describe,expect,it } from 'vitest';
import { coupons,products,users } from '../../src/server/data/catalog';
import { MockLLMProvider } from '../../src/server/llm/MockLLMProvider';
import { runChat } from '../../src/server/services/chatService';
import { runCoupon } from '../../src/server/services/couponEngine';
import { runRecommendation } from '../../src/server/services/productMatcher';

const llm=new MockLLMProvider();

describe('Recommendation stage',()=>{
  it('hard-filters inactive and coupon-out-of-scope products, then explains score',async()=>{
    const need=(await runChat('Sedan车龄3年，两周内续保，预算900，担心水浸，日常通勤。','hybrid',llm)).output!;
    const coupon=(await runCoupon(need,users[0],coupons,products,'hybrid',llm)).output!;
    const result=await runRecommendation(need,users[0],coupon,products,'hybrid',llm);
    expect(result.output?.recommended_products.map((x)=>x.product_id)).toEqual(['P008','P001','P005','P002']);
    expect(result.output?.excluded_products.find((x)=>x.product_id==='P004')?.reason_codes).toContain('PRODUCT_INACTIVE');
    expect(result.output?.recommended_products[0].score_breakdown.coverage).toBeGreaterThan(0);
    expect(Object.keys(result.output!.recommended_products[0].score_breakdown)).toEqual(['coverage','budget']);
  });

  it('ranking changes when coverage priority changes',async()=>{
    const need=(await runChat('Sedan车龄3年，两周内续保，预算700，只要便宜和第三者责任。','hybrid',llm)).output!;
    const coupon=(await runCoupon(need,users[0],coupons,products,'hybrid',llm)).output!;
    const result=await runRecommendation(need,users[0],coupon,products,'hybrid',llm);
    expect(result.output?.recommended_products[0].product_id).toBe('P002');
  });

  it('keeps only products that support an older Hatchback',async()=>{
    const need=(await runChat('Hatchback车龄12年，两个月后续保，预算600。','hybrid',llm)).output!;
    const noCoupon={decision:'reject' as const,selected_coupon_id:null,discount_value:0,currency:'MYR' as const,eligible_product_ids:[],reason_codes:[],rejected_coupon_ids:[],fallback_status:'none' as const};
    const result=await runRecommendation(need,users[3],noCoupon,products,'hybrid',llm);
    expect(result.output?.recommended_products.map((x)=>x.product_id).sort()).toEqual(['P002','P007','P008']);
  });

  it('llm-only comparison includes an inactive product',async()=>{
    const need=(await runChat('Sedan车龄3年续保，预算900。','hybrid',llm)).output!;
    const coupon=(await runCoupon(need,users[0],coupons,products,'hybrid',llm)).output!;
    const result=await runRecommendation(need,users[0],coupon,products,'llm_only',llm);
    expect(result.output?.recommended_products.some((x)=>x.product_id==='P004')).toBe(true);
  });

  it('exposes a filter trace for every product and score formula for every result',async()=>{
    const need=(await runChat('Sedan车龄3年续保，预算900，要水浸。','hybrid',llm)).output!;
    const coupon=(await runCoupon(need,users[0],coupons,products,'hybrid',llm)).output!;
    const result=await runRecommendation(need,users[0],coupon,products,'hybrid',llm);
    expect(result.trace.filter((x)=>x.kind==='filter')).toHaveLength(products.length);
    expect(result.trace.filter((x)=>x.kind==='score')).toHaveLength(result.output!.recommended_products.length);
    expect(result.trace.find((x)=>x.kind==='score')?.logic).toContain('保障分=60');
  });
});
