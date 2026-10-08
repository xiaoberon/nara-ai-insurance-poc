import { describe,expect,it } from 'vitest';
import { testCases } from '../../src/server/data/testCases';
import { compareModes } from '../../src/server/services/evaluationService';
import { runFull } from '../../src/server/services/runService';

describe('Full four-stage run',()=>{
  it('links four stage outputs under one audit id',async()=>{
    const run=await runFull({case:testCases[0],mode:'hybrid',persist:false});
    expect(run.audit.run_id).toMatch(/[0-9a-f-]{36}/);
    expect(run.stages.chat.output?.intent).toBe('renew_car_insurance');
    expect(run.stages.coupon.output?.decision).toBe('grant');
    expect(run.stages.recommendation.output?.recommended_products.length).toBeGreaterThanOrEqual(2);
    expect(run.stages.comparison.output?.products).toHaveLength(2);
  });

  it('runs all 20 cases in all three modes and reports measured metrics',async()=>{
    const evaluation=await compareModes(1);
    expect(evaluation.test_case_count).toBe(20);
    expect(evaluation.modes).toHaveLength(3);
    expect(evaluation.modes.every((x)=>x.runs===20)).toBe(true);
    expect(evaluation.modes.every((x)=>typeof x.chat_pass_rate==='number'&&typeof x.voucher_pass_rate==='number'&&typeof x.recommendation_pass_rate==='number'&&typeof x.comparison_pass_rate==='number'&&typeof x.full_chain_pass_rate==='number')).toBe(true);
    expect(evaluation.modes.find((x)=>x.mode==='llm_only')!.hard_condition_violations).toBeGreaterThan(0);
    expect(evaluation.note).toContain('no superiority values are prefilled');
  });

  it('runs the five-case typical suite as 75 paired executions',async()=>{
    const evaluation=await compareModes(5,'typical');
    expect(evaluation.test_case_count).toBe(5);
    expect(evaluation.profile_count).toBe(3);
    expect(evaluation.execution_count).toBe(75);
    expect(evaluation.modes.every((x)=>x.runs===25)).toBe(true);
  });

  it('can evaluate only the currently selected case in three executions',async()=>{
    const evaluation=await compareModes(1,'current','C12');
    expect(evaluation.test_case_count).toBe(1);
    expect(evaluation.execution_count).toBe(3);
    expect(evaluation.case_results[0].case_id).toBe('C12');
    expect(evaluation.case_results[0].expected.comparison.required_conflict).toBe('P005.deductible');
  });
});
