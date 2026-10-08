import type { UserNeed } from '../../shared/types.js';

export interface ChatExpectation {
  intent: UserNeed['intent'];
  information_status: 'complete' | 'needs_clarification';
  vehicle_type?: string;
  vehicle_age_years?: number;
  max_annual_premium?: number;
  must_include_coverage?: string[];
  must_report_missing?: string[];
}

export interface VoucherExpectation {
  decision: 'grant' | 'reject' | 'review';
  selected_coupon_id?: string;
  required_reason?: string;
}

export interface RecommendationExpectation {
  acceptable_top1: string[];
  must_exclude?: string[];
  must_cover?: string[];
  must_be_within_budget?: boolean;
}

export interface ComparisonExpectation {
  assertions: Record<string, string | number>;
  requires_manual_review: boolean;
  required_conflict?: string;
}

export interface CaseEvaluationExpectation {
  chat: ChatExpectation;
  voucher: VoucherExpectation;
  recommendation: RecommendationExpectation;
  comparison: ComparisonExpectation;
}

// MVP ground truth: each case keeps only the few assertions needed to prove the
// four-stage decision chain. It intentionally does not prescribe every field or
// the full recommendation order.
export const evaluationExpectations: Record<string, CaseEvaluationExpectation> = {
  C01: {
    chat: { intent: 'renew_car_insurance', information_status: 'complete', vehicle_type: 'Sedan', vehicle_age_years: 3, max_annual_premium: 900, must_include_coverage: ['flood'] },
    voucher: { decision: 'grant', selected_coupon_id: 'CPN-RENEW-50' },
    recommendation: { acceptable_top1: ['P001', 'P008'], must_cover: ['flood'], must_be_within_budget: true },
    comparison: { assertions: { 'P001.annual_premium': 820, 'P002.flood': 'not_stated' }, requires_manual_review: false },
  },
  C02: {
    chat: { intent: 'renew_car_insurance', information_status: 'complete', vehicle_type: 'SUV', vehicle_age_years: 7, max_annual_premium: 1000, must_include_coverage: ['theft', 'roadside'] },
    voucher: { decision: 'reject', required_reason: 'FREQUENCY_LIMIT_REACHED' },
    recommendation: { acceptable_top1: ['P001', 'P008'], must_cover: ['roadside'], must_be_within_budget: true },
    comparison: { assertions: { 'P001.roadside_assistance': 'included', 'P003.annual_premium': 1080 }, requires_manual_review: false },
  },
  C03: {
    chat: { intent: 'renew_car_insurance', information_status: 'complete', vehicle_type: 'Sedan', vehicle_age_years: 2, max_annual_premium: 700, must_include_coverage: ['third_party'] },
    voucher: { decision: 'grant', selected_coupon_id: 'CPN-RENEW-50' },
    recommendation: { acceptable_top1: ['P002'], must_cover: ['third_party'], must_be_within_budget: true },
    comparison: { assertions: { 'P002.annual_premium': 690, 'P002.flood': 'not_stated' }, requires_manual_review: false },
  },
  C04: {
    chat: { intent: 'renew_car_insurance', information_status: 'complete', vehicle_type: 'SUV', vehicle_age_years: 8, max_annual_premium: 1200, must_include_coverage: ['flood', 'fire', 'theft', 'personal_accident'] },
    voucher: { decision: 'grant', selected_coupon_id: 'CPN-RENEW-50' },
    recommendation: { acceptable_top1: ['P001', 'P005', 'P008'], must_cover: ['flood'], must_be_within_budget: true },
    comparison: { assertions: { 'P003.annual_premium': 1080, 'P003.flood': 'covered' }, requires_manual_review: false },
  },
  C05: {
    chat: { intent: 'renew_car_insurance', information_status: 'needs_clarification', vehicle_type: 'Sedan', vehicle_age_years: 3, must_include_coverage: ['flood'], must_report_missing: ['budget.max_annual_premium'] },
    voucher: { decision: 'grant', selected_coupon_id: 'CPN-RENEW-50' },
    recommendation: { acceptable_top1: ['P001', 'P008'], must_cover: ['flood'] },
    comparison: { assertions: { 'P001.flood': 'covered', 'P002.flood': 'not_stated' }, requires_manual_review: false },
  },
  C06: {
    chat: { intent: 'renew_car_insurance', information_status: 'complete', vehicle_type: 'SUV', vehicle_age_years: 7, max_annual_premium: 1000, must_include_coverage: ['roadside'] },
    voucher: { decision: 'reject', required_reason: 'FREQUENCY_LIMIT_REACHED' },
    recommendation: { acceptable_top1: ['P001', 'P008'], must_cover: ['roadside'], must_be_within_budget: true },
    comparison: { assertions: { 'P001.roadside_assistance': 'included', 'P003.annual_premium': 1080 }, requires_manual_review: false },
  },
  C07: {
    chat: { intent: 'renew_car_insurance', information_status: 'needs_clarification', must_report_missing: ['vehicle.type', 'vehicle.age_years', 'budget.max_annual_premium'] },
    voucher: { decision: 'reject', required_reason: 'HIGH_RISK_COUPON_BLOCKED' },
    recommendation: { acceptable_top1: ['P002', 'P007', 'P008'] },
    comparison: { assertions: { 'P001.annual_premium': 820, 'P002.flood': 'not_stated' }, requires_manual_review: false },
  },
  C08: {
    chat: { intent: 'renew_car_insurance', information_status: 'needs_clarification', vehicle_type: 'Sedan', must_include_coverage: ['flood'], must_report_missing: ['vehicle.age_years', 'budget.max_annual_premium'] },
    voucher: { decision: 'reject', required_reason: 'HIGH_RISK_COUPON_BLOCKED' },
    recommendation: { acceptable_top1: ['P001', 'P008'], must_cover: ['flood'] },
    comparison: { assertions: { 'P001.flood': 'covered', 'P002.flood': 'not_stated' }, requires_manual_review: false },
  },
  C09: {
    chat: { intent: 'renew_car_insurance', information_status: 'needs_clarification', vehicle_type: 'Sedan', max_annual_premium: 900, must_report_missing: ['vehicle.age_years'] },
    voucher: { decision: 'reject', required_reason: 'MARKET_NOT_ELIGIBLE' },
    recommendation: { acceptable_top1: [] },
    comparison: { assertions: { 'P001.annual_premium': 820, 'P002.flood': 'not_stated' }, requires_manual_review: false },
  },
  C10: {
    chat: { intent: 'renew_car_insurance', information_status: 'complete', vehicle_type: 'Hatchback', vehicle_age_years: 12, max_annual_premium: 600, must_include_coverage: ['third_party'] },
    voucher: { decision: 'reject', required_reason: 'SEGMENT_NOT_ELIGIBLE' },
    recommendation: { acceptable_top1: ['P007'], must_cover: ['third_party'], must_be_within_budget: true },
    comparison: { assertions: { 'P002.annual_premium': 690, 'P004.annual_premium': 'not_stated' }, requires_manual_review: false },
  },
  C11: {
    chat: { intent: 'renew_car_insurance', information_status: 'complete', vehicle_type: 'SUV', vehicle_age_years: 7, max_annual_premium: 1000, must_include_coverage: ['roadside'] },
    voucher: { decision: 'reject', required_reason: 'FREQUENCY_LIMIT_REACHED' },
    recommendation: { acceptable_top1: ['P001', 'P008'], must_cover: ['roadside'], must_be_within_budget: true },
    comparison: { assertions: { 'P001.roadside_assistance': 'included', 'P003.annual_premium': 1080 }, requires_manual_review: false },
  },
  C12: {
    chat: { intent: 'renew_car_insurance', information_status: 'needs_clarification', vehicle_type: 'Sedan', max_annual_premium: 900, must_include_coverage: ['flood'], must_report_missing: ['vehicle.age_years'] },
    voucher: { decision: 'grant', selected_coupon_id: 'CPN-RENEW-50' },
    recommendation: { acceptable_top1: ['P001', 'P005', 'P008'], must_cover: ['flood'], must_be_within_budget: true },
    comparison: { assertions: { 'P005.deductible': 'not_stated' }, requires_manual_review: true, required_conflict: 'P005.deductible' },
  },
  C13: {
    chat: { intent: 'renew_car_insurance', information_status: 'complete', vehicle_type: 'MPV', vehicle_age_years: 5, max_annual_premium: 1200, must_include_coverage: ['flood', 'personal_accident', 'roadside'] },
    voucher: { decision: 'grant', selected_coupon_id: 'CPN-STACK-20' },
    recommendation: { acceptable_top1: ['P003', 'P006'], must_cover: ['flood', 'personal_accident'], must_be_within_budget: true },
    comparison: { assertions: { 'P003.annual_premium': 1080, 'P006.deductible': 350 }, requires_manual_review: false },
  },
  C14: {
    chat: { intent: 'renew_car_insurance', information_status: 'complete', vehicle_type: 'Sedan', vehicle_age_years: 1, max_annual_premium: 650, must_include_coverage: ['third_party'] },
    voucher: { decision: 'reject', required_reason: 'FREQUENCY_LIMIT_REACHED' },
    recommendation: { acceptable_top1: ['P002', 'P007'], must_cover: ['third_party'], must_be_within_budget: true },
    comparison: { assertions: { 'P007.flood': 'not_stated', 'P002.annual_premium': 690 }, requires_manual_review: false },
  },
  C15: {
    chat: { intent: 'renew_car_insurance', information_status: 'complete', vehicle_type: 'Sedan', vehicle_age_years: 4, max_annual_premium: 950, must_include_coverage: ['flood'] },
    voucher: { decision: 'reject', required_reason: 'FREQUENCY_LIMIT_REACHED' },
    recommendation: { acceptable_top1: ['P005', 'P008'], must_cover: ['flood'], must_be_within_budget: true },
    comparison: { assertions: { 'P005.deductible': 'not_stated' }, requires_manual_review: true, required_conflict: 'P005.deductible' },
  },
  C16: {
    chat: { intent: 'renew_car_insurance', information_status: 'complete', vehicle_type: 'SUV', vehicle_age_years: 11, max_annual_premium: 850, must_include_coverage: ['roadside'] },
    voucher: { decision: 'grant', selected_coupon_id: 'CPN-RENEW-50' },
    recommendation: { acceptable_top1: ['P008'], must_exclude: ['P006'], must_cover: ['roadside'], must_be_within_budget: true },
    comparison: { assertions: { 'P008.annual_premium': 760, 'P006.annual_premium': 960 }, requires_manual_review: false },
  },
  C17: {
    chat: { intent: 'renew_car_insurance', information_status: 'needs_clarification', must_report_missing: ['vehicle.type', 'vehicle.age_years', 'budget.max_annual_premium'] },
    voucher: { decision: 'reject', required_reason: 'HIGH_RISK_COUPON_BLOCKED' },
    recommendation: { acceptable_top1: ['P002', 'P007', 'P008'] },
    comparison: { assertions: { 'P001.annual_premium': 820, 'P008.annual_premium': 760 }, requires_manual_review: false },
  },
  C18: {
    chat: { intent: 'renew_car_insurance', information_status: 'complete', vehicle_type: 'Sedan', vehicle_age_years: 3, max_annual_premium: 900, must_include_coverage: ['flood', 'roadside'] },
    voucher: { decision: 'grant', selected_coupon_id: 'CPN-RENEW-50' },
    recommendation: { acceptable_top1: ['P001', 'P008'], must_cover: ['flood', 'roadside'], must_be_within_budget: true },
    comparison: { assertions: { 'P001.flood': 'covered', 'P008.roadside_assistance': 'included' }, requires_manual_review: false },
  },
  C19: {
    chat: { intent: 'renew_car_insurance', information_status: 'complete', vehicle_type: 'Sedan', vehicle_age_years: 6, max_annual_premium: 1300, must_include_coverage: ['flood', 'fire', 'personal_accident'] },
    voucher: { decision: 'grant', selected_coupon_id: 'CPN-VIP-100' },
    recommendation: { acceptable_top1: ['P003'], must_cover: ['flood', 'fire', 'personal_accident'], must_be_within_budget: true },
    comparison: { assertions: { 'P003.annual_premium': 1080, 'P006.deductible': 350 }, requires_manual_review: false },
  },
  C20: {
    chat: { intent: 'renew_car_insurance', information_status: 'complete', vehicle_type: 'Hatchback', vehicle_age_years: 12, max_annual_premium: 600, must_include_coverage: ['third_party'] },
    voucher: { decision: 'reject', required_reason: 'SEGMENT_NOT_ELIGIBLE' },
    recommendation: { acceptable_top1: ['P007'], must_cover: ['third_party'], must_be_within_budget: true },
    comparison: { assertions: { 'P007.flood': 'not_stated', 'P002.flood': 'not_stated' }, requires_manual_review: false },
  },
};
