import type { ComparisonResult, Coupon, InsuranceProduct, PdpDocument, UserNeed, UserProfile } from '../../shared/types';

export interface LLMCallOptions { attempt?: number; fault?: string }

export interface LLMProvider {
  readonly name: string;
  usageSnapshot?(): LLMUsage;
  parseUserNeed(message: string, options?: LLMCallOptions): Promise<unknown>;
  chooseCoupon(need: UserNeed, profile: UserProfile, coupons: Coupon[]): Promise<unknown>;
  rankProducts(need: UserNeed, products: InsuranceProduct[], discount: number): Promise<unknown>;
  compareProducts(products: InsuranceProduct[], pdps: PdpDocument[], discount: number, options?: LLMCallOptions): Promise<unknown>;
}

export interface LLMUsage { input_tokens: number; output_tokens: number; estimated_cost_usd: number }

export function estimateMockUsage(input: unknown, output: unknown): LLMUsage {
  return {
    input_tokens: Math.ceil(JSON.stringify(input).length / 4),
    output_tokens: Math.ceil(JSON.stringify(output).length / 4),
    estimated_cost_usd: 0
  };
}
