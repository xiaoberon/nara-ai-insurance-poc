import { describe,expect,it } from 'vitest';
import { pdps,products } from '../../src/server/data/catalog';
import { MockLLMProvider } from '../../src/server/llm/MockLLMProvider';
import { runChat } from '../../src/server/services/chatService';
import { runComparison } from '../../src/server/services/comparisonExtractor';
import { htmlToPlainText } from '../../src/server/services/pdpText';

const llm=new MockLLMProvider();
const getNeed=async()=> (await runChat('Sedan车龄3年续保，预算900，担心水浸。','hybrid',llm)).output!;

describe('Comparison stage',()=>{
  it('builds extraction corpus from PDP HTML instead of Product Definition',()=>{
    const source=htmlToPlainText(pdps[0].html);
    expect(source).toContain('年保费 MYR 820');
    expect(source).not.toContain('<article');
  });
  it('normalizes terms and preserves evidence from each PDP',async()=>{
    const result=await runComparison(await getNeed(),['P001','P002'],products,pdps,50,'hybrid',llm);
    expect(result.schema_valid).toBe(true);
    expect(result.output?.products[0].annual_premium).toBe(820);
    expect(result.output?.products[0].evidence.premium).toContain('年保费 MYR 820');
    expect(result.output?.products[1].coverage.flood).toBe('not_stated');
    expect(result.output?.products[1].deductible).toBe(600);
    expect(result.output?.products[0].vehicle_eligibility).toBe('适用10年内 Sedan 或 SUV');
    expect(result.output?.products[0].coverage.third_party).toBe('covered');
    expect(result.output?.products[0].coverage.personal_accident).toBe('not_stated');
    expect(result.output?.products[0].not_stated_fields).toContain('coverage.personal_accident');
    expect(result.trace.filter((x)=>x.step_id.startsWith('extract-'))).toHaveLength(2);
    expect(result.trace.at(-1)?.reason_code).toBe('COMPARISON_VALID');
  });

  it('marks unstated fields and never fills them from assumptions',async()=>{
    const result=await runComparison(await getNeed(),['P001','P005'],products,pdps,50,'hybrid',llm);
    const rainReady=result.output?.products.find((x)=>x.product_id==='P005');
    expect(rainReady?.roadside_assistance).toBe('not_stated');
    expect(rainReady?.not_stated_fields).toContain('roadside_assistance');
  });

  it('flags conflicting deductible values for manual review',async()=>{
    const result=await runComparison(await getNeed(),['P001','P005'],products,pdps,50,'hybrid',llm);
    expect(result.output?.requires_manual_review).toBe(true);
    expect(result.output?.products.find((x)=>x.product_id==='P005')?.deductible).toBe('not_stated');
    expect(result.output?.products.find((x)=>x.product_id==='P005')?.not_stated_fields).not.toContain('deductible');
    expect(result.fallback_status).toBe('manual_review');
  });

  it('treats negative disclosure wording as not stated',async()=>{
    const result=await runComparison(await getNeed(),['P002','P007'],products,pdps,0,'rules_only',llm);
    const citySaver=result.output?.products.find((x)=>x.product_id==='P007');
    expect(citySaver?.coverage.flood).toBe('not_stated');
    expect(citySaver?.not_stated_fields).toContain('coverage.flood');
  });

  it('rejects evidence that is not present in source PDP',async()=>{
    const badProvider=new MockLLMProvider();
    const original=badProvider.compareProducts.bind(badProvider);
    badProvider.compareProducts=async(...args)=>{
      const value=await original(...args) as any;
      value.products[0].evidence.premium='invented evidence';
      return value;
    };
    const result=await runComparison(await getNeed(),['P001','P002'],products,pdps,50,'hybrid',badProvider);
    expect(result.output).toBeNull();
    expect(result.fallback_status).toBe('raw_pdp_only');
    expect(result.error).toContain('SOURCE_NOT_FOUND');
  });
});
