import { z } from 'zod';

export const userNeedSchema = z.object({
  intent: z.enum(['renew_car_insurance', 'unknown']),
  vehicle: z.object({ type: z.enum(['Sedan', 'SUV', 'Hatchback', 'MPV', 'unknown']), age_years: z.number().int().min(0).max(30).nullable() }),
  budget: z.object({ currency: z.literal('MYR'), max_annual_premium: z.number().positive().max(100000).nullable() }),
  coverage_priorities: z.array(z.string()),
  usage: z.enum(['daily_commute', 'long_distance', 'occasional', 'unknown']),
  price_sensitivity: z.enum(['high', 'medium', 'low', 'unknown']),
  renewal_urgency: z.enum(['within_2_weeks', 'within_month', 'not_urgent', 'unknown']),
  missing_fields: z.array(z.string()),
  information_status: z.enum(['complete','needs_clarification']),
  evidence_summary: z.array(z.string())
});

export const couponDecisionSchema = z.object({
  decision: z.enum(['grant', 'reject', 'review']),
  selected_coupon_id: z.string().nullable(),
  discount_value: z.number().nonnegative(),
  currency: z.literal('MYR'),
  eligible_product_ids: z.array(z.string()),
  reason_codes: z.array(z.string()),
  rejected_coupon_ids: z.array(z.object({ coupon_id: z.string(), reason_code: z.string() })),
  fallback_status: z.enum(['none', 'clarification_required', 'manual_review', 'mock_degraded'])
});

export const recommendationResultSchema = z.object({
  recommended_products: z.array(z.object({
    rank: z.number().int().positive(), product_id: z.string(), product_name: z.string(),
    original_premium: z.number(), premium_after_coupon: z.number(), match_score: z.number().min(0).max(100),
    score_breakdown: z.object({ coverage: z.number(), budget: z.number() }),
    recommendation_reasons: z.array(z.string())
  })),
  excluded_products: z.array(z.object({ product_id: z.string(), reason_codes: z.array(z.string()) })),
  fallback_status: z.enum(['none', 'soft_preferences_relaxed', 'no_match'])
});

const statedNumber = z.union([z.number(), z.literal('not_stated')]);
export const comparisonResultSchema = z.object({
  products: z.array(z.object({
    product_id: z.string(), product_name: z.string(), insurer: z.string(), annual_premium: statedNumber,
    discount_amount: z.number(), premium_after_coupon: statedNumber, sum_insured: statedNumber,
    coverage: z.record(z.string()), deductible: statedNumber,
    roadside_assistance: z.string(), term_and_waiting_period: z.string(), exclusions: z.array(z.string()),
    claim_channel_and_documents: z.string(), vehicle_eligibility: z.string(), not_stated_fields: z.array(z.string()).optional().default([]),
    conflicts: z.array(z.string()), evidence: z.record(z.string()), match_summary: z.string()
  })),
  requires_manual_review: z.boolean(),
  fallback_status: z.enum(['none', 'raw_pdp_only', 'manual_review']),
  errors: z.array(z.string())
});
