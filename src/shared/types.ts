export type DecisionMode = 'hybrid' | 'rules_only' | 'llm_only';

export interface UserNeed {
  intent: 'renew_car_insurance' | 'unknown';
  vehicle: { type: 'Sedan' | 'SUV' | 'Hatchback' | 'MPV' | 'unknown'; age_years: number | null };
  budget: { currency: 'MYR'; max_annual_premium: number | null };
  coverage_priorities: string[];
  usage: 'daily_commute' | 'long_distance' | 'occasional' | 'unknown';
  price_sensitivity: 'high' | 'medium' | 'low' | 'unknown';
  renewal_urgency: 'within_2_weeks' | 'within_month' | 'not_urgent' | 'unknown';
  missing_fields: string[];
  information_status: 'complete' | 'needs_clarification';
  evidence_summary: string[];
}

export interface UserProfile {
  user_id: string;
  market: string;
  age_band: string;
  vehicle_type: string;
  vehicle_age_years: number;
  renewal_due_days: number;
  current_policy_tier: string;
  historical_purchase_count: number;
  price_sensitivity: string;
  preferred_channel: string;
  coupon_received_30d: number;
  coupon_used_30d: number;
  segment: string;
  profile_snapshot_id: string;
  generated_at: string;
  demographics: {
    display_name_masked: string;
    age: number;
    gender: 'female' | 'male' | 'undisclosed';
    nationality: string;
    postcode_region: string;
    marital_status: 'single' | 'married' | 'undisclosed';
    pii_available_but_not_loaded: string[];
  };
  vehicles: VehicleRecord[];
  policies: PolicyRecord[];
  behavior_features: BehaviorFeatures;
  privacy: { purpose: string; llm_allowed_fields: string[]; blocked_fields: string[] };
}

export interface VehicleRecord {
  vehicle_id: string;
  registration_masked: string;
  type: 'Sedan' | 'SUV' | 'Hatchback' | 'MPV';
  make: string;
  model: string;
  manufacture_year: number;
  vehicle_age_years: number;
  usage: 'private_daily_commute' | 'private_long_distance' | 'private_occasional';
  current_market_value: number;
  financing_status: 'paid' | 'financed';
  modified: boolean;
  ncd_percent: number;
  claims_3y: number;
}

export interface PolicyRecord {
  policy_id: string;
  vehicle_id: string;
  product_id: string;
  provider_name: string;
  policy_name: string;
  effective_date: string;
  expiry_date: string;
  policyholder: 'self' | 'spouse';
  insured_object: string;
  annual_premium: number;
  sum_insured: number;
  coverage_tags: string[];
}

export interface BehaviorFeatures {
  tags: string[];
  viewed_product_ids_30d: string[];
  motor_pdp_dwell_seconds_30d: number;
  marketplace_category_tags: string[];
  last_updated_at: string;
}

export interface Coupon {
  coupon_id: string;
  name: string;
  discount_type: 'fixed';
  discount_value: number;
  currency: 'MYR';
  minimum_premium: number;
  maximum_discount: number;
  eligible_markets: string[];
  eligible_segments: string[];
  eligible_product_ids: string[];
  per_user_limit_30d: number;
  stackable: boolean;
  budget_remaining: number;
  valid_from: string;
  valid_to: string;
  batch_name: string;
  total_instances: number;
  issued_instances: number;
  claimed_instances: number;
  redeemed_instances: number;
  status: 'active' | 'paused' | 'exhausted' | 'expired';
}

export interface VoucherInstance {
  voucher_instance_id: string;
  voucher_batch_id: string;
  serial_masked: string;
  status: 'available' | 'claimed' | 'redeemed' | 'expired';
}

export interface UserVoucher {
  user_voucher_id: string;
  voucher_instance_id: string;
  voucher_batch_id: string;
  user_id: string;
  status: 'claimed' | 'redeemed' | 'expired';
  claimed_at: string;
  expires_at: string;
  redeemed_order_id: string | null;
}

export interface CouponDecision {
  decision: 'grant' | 'reject' | 'review';
  selected_coupon_id: string | null;
  discount_value: number;
  currency: 'MYR';
  eligible_product_ids: string[];
  reason_codes: string[];
  rejected_coupon_ids: Array<{ coupon_id: string; reason_code: string }>;
  fallback_status: 'none' | 'clarification_required' | 'manual_review' | 'mock_degraded';
}

export interface InsuranceProduct {
  product_id: string;
  product_name: string;
  insurer: string;
  market: string;
  active: boolean;
  annual_premium: number;
  currency: 'MYR';
  sum_insured: number;
  coverage_tags: string[];
  deductible: number;
  roadside_assistance: boolean;
  claim_channel: string[];
  eligible_vehicle_types: string[];
  maximum_vehicle_age_years: number;
  coupon_ids: string[];
  pdp_id: string;
}

export interface ProductContent {
  product_id: string;
  card: {
    avatar: string;
    accent: string;
    selling_points: [string, string];
    badge: string | null;
  };
  product_highlights: Array<{ label: string; value: string; icon: string }>;
  claim_process: string[];
  customer_service: { channels: string[]; hours: string };
  pdp_route: string;
  cms_version: string;
}

export interface RecommendedProduct {
  rank: number;
  product_id: string;
  product_name: string;
  original_premium: number;
  premium_after_coupon: number;
  match_score: number;
  score_breakdown: { coverage: number; budget: number };
  recommendation_reasons: string[];
}

export interface RecommendationResult {
  recommended_products: RecommendedProduct[];
  excluded_products: Array<{ product_id: string; reason_codes: string[] }>;
  fallback_status: 'none' | 'soft_preferences_relaxed' | 'no_match';
}

export interface PdpDocument {
  pdp_id: string;
  product_id: string;
  route: string;
  cms_version: string;
  content_type: 'text/html';
  html: string;
}

export interface ComparisonItem {
  product_id: string;
  product_name: string;
  insurer: string;
  annual_premium: number | 'not_stated';
  discount_amount: number;
  premium_after_coupon: number | 'not_stated';
  sum_insured: number | 'not_stated';
  coverage: Record<string, string>;
  deductible: number | 'not_stated';
  roadside_assistance: string;
  term_and_waiting_period: string;
  exclusions: string[];
  claim_channel_and_documents: string;
  vehicle_eligibility: string;
  not_stated_fields: string[];
  conflicts: string[];
  evidence: Record<string, string>;
  match_summary: string;
}

export interface ComparisonResult {
  products: ComparisonItem[];
  requires_manual_review: boolean;
  fallback_status: 'none' | 'raw_pdp_only' | 'manual_review';
  errors: string[];
}

export interface NodeLog {
  node: string;
  status: 'success' | 'warning' | 'failed';
  summary: string;
  duration_ms: number;
}

export interface DecisionTraceStep {
  step_id: string;
  stage: 'chat' | 'coupon' | 'recommendation' | 'comparison';
  kind: 'llm' | 'rule' | 'filter' | 'score' | 'validation' | 'normalization' | 'fallback';
  title: string;
  description: string;
  input: Record<string, unknown>;
  logic: string;
  output: Record<string, unknown>;
  status: 'passed' | 'failed' | 'warning' | 'info';
  reason_code?: string;
  evidence?: string[];
}

export interface StageResult<T> {
  input: unknown;
  output: T | null;
  decision_summary: string[];
  node_logs: NodeLog[];
  trace: DecisionTraceStep[];
  schema_valid: boolean;
  retry_count: number;
  fallback_status: string;
  error?: string;
}

export interface AuditInfo {
  run_id: string;
  timestamp: string;
  mode: DecisionMode;
  model: string;
  model_config: string;
  total_duration_ms: number;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
  schema_valid: boolean;
  retry_count: number;
  manual_review: boolean;
}

export interface FullRunResult {
  audit: AuditInfo;
  stages: {
    chat: StageResult<UserNeed>;
    coupon: StageResult<CouponDecision>;
    recommendation: StageResult<RecommendationResult>;
    comparison: StageResult<ComparisonResult>;
  };
}

export interface TestCase {
  id: string;
  category: 'normal' | 'colloquial' | 'invalid' | 'coupon_boundary' | 'coupon_conflict' | 'pdp_conflict';
  name: string;
  message: string;
  profile_id: string;
  selected_product_ids?: string[];
  mock_fault?: 'invalid_json_once' | 'timeout_once' | 'pdp_conflict';
  expected: { intent: UserNeed['intent']; coupon_eligible: boolean | 'review'; required_coverage?: string[] };
}

export interface FieldDefinition {
  field: string;
  meaning: string;
  example: string;
  source: string;
  llm_access: 'allowed' | 'masked' | 'blocked';
}

export interface DataDictionary {
  users: FieldDefinition[];
  vehicles: FieldDefinition[];
  policies: FieldDefinition[];
  behavior: FieldDefinition[];
  voucher_batches: FieldDefinition[];
  voucher_instances: FieldDefinition[];
  user_vouchers: FieldDefinition[];
  product_definitions: FieldDefinition[];
  product_cards: FieldDefinition[];
  pdp_pages: FieldDefinition[];
}
