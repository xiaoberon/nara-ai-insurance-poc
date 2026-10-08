import type { LLMProvider } from './LLMProvider';
import type { Coupon, InsuranceProduct, PdpDocument, UserNeed, UserProfile } from '../../shared/types';
import type { LLMCallOptions } from './LLMProvider';
import { MockLLMProvider } from './MockLLMProvider';

const mock=new MockLLMProvider();
// The public portfolio deployment always uses deterministic mock responses.
// It therefore exposes no model key, user input retention, or paid inference.
export const llmProvider:LLMProvider=mock;
