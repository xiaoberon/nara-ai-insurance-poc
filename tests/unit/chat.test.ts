import { describe, expect, it } from 'vitest';
import { MockLLMProvider } from '../../src/server/llm/MockLLMProvider';
import { runChat } from '../../src/server/services/chatService';

const llm = new MockLLMProvider();

describe('Chat stage', () => {
  it('hybrid extracts colloquial flood and commute intent', async () => {
    const result = await runChat('雨季车快到期，泡水能赔最好，平时上班开，Sedan车龄3年，预算900以内。','hybrid',llm);
    expect(result.schema_valid).toBe(true);
    expect(result.output?.coverage_priorities).toContain('flood');
    expect(result.output?.usage).toBe('daily_commute');
    expect(result.trace.some((x)=>x.kind==='llm'&&x.evidence?.length)).toBe(true);
    expect(result.trace.some((x)=>x.kind==='validation'&&x.reason_code==='USER_NEED_SCHEMA_VALID')).toBe(true);
  });

  it('retries one invalid structured response', async () => {
    const result = await runChat('Sedan车龄3年车险续保，预算900。','hybrid',llm,'invalid_json_once');
    expect(result.retry_count).toBe(1);
    expect(result.schema_valid).toBe(true);
  });

  it('marks missing facts instead of inventing them', async () => {
    const result = await runChat('帮我看看续保。','hybrid',llm);
    expect(result.output?.vehicle.type).toBe('unknown');
    expect(result.output?.missing_fields).toContain('budget.max_annual_premium');
    expect(result.fallback_status).toBe('clarification_required');
  });

  it('detects contradictory budget statements', async () => {
    const result = await runChat('Sedan续保，预算最多600，但1000以内都可以。','hybrid',llm);
    expect(result.output?.budget.max_annual_premium).toBeNull();
    expect(result.output?.missing_fields).toContain('budget.conflict_requires_confirmation');
  });
});
