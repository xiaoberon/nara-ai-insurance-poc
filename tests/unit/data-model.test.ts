import { describe,expect,it } from 'vitest';
import { coupons,pdps,productContents,products,userVouchers,users,voucherInstances } from '../../src/server/data/catalog';
import { dataDictionary } from '../../src/server/data/dictionary';

describe('Diversified fictional data model',()=>{
  it('contains multiple linked users, vehicles, policies, products and voucher layers',()=>{
    expect(users.length).toBeGreaterThanOrEqual(8);
    expect(new Set(users.map((x)=>x.user_id)).size).toBe(users.length);
    expect(users.every((x)=>x.vehicles.length>0&&x.policies.length>0&&x.privacy.blocked_fields.includes('national_id'))).toBe(true);
    expect(products.length).toBeGreaterThanOrEqual(8);
    expect(products.every((product)=>pdps.some((pdp)=>pdp.product_id===product.product_id))).toBe(true);
    expect(products.every((product)=>productContents.some((content)=>content.product_id===product.product_id))).toBe(true);
    expect(pdps.every((pdp)=>pdp.content_type==='text/html'&&pdp.html.includes('<article')&&pdp.route.includes(pdp.product_id))).toBe(true);
    expect(coupons.length).toBeGreaterThanOrEqual(6);
    expect(voucherInstances.every((instance)=>coupons.some((batch)=>batch.coupon_id===instance.voucher_batch_id))).toBe(true);
    expect(userVouchers.every((item)=>users.some((user)=>user.user_id===item.user_id))).toBe(true);
  });

  it('documents every database group and LLM access level',()=>{
    expect(Object.keys(dataDictionary)).toEqual(['users','vehicles','policies','behavior','voucher_batches','voucher_instances','user_vouchers','product_definitions','product_cards','pdp_pages']);
    expect(Object.values(dataDictionary).flat().every((field)=>field.meaning&&field.source&&field.llm_access)).toBe(true);
  });
});
