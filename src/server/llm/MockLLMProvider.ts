import type { ComparisonItem, ComparisonResult, Coupon, InsuranceProduct, PdpDocument, UserNeed, UserProfile } from '../../shared/types';
import type { LLMCallOptions, LLMProvider } from './LLMProvider';
import { pdpTextFor } from '../services/pdpText';

const has = (text: string, terms: string[]) => terms.some((term) => text.toLowerCase().includes(term.toLowerCase()));
const firstNumber = (text: string, patterns: RegExp[]) => {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return Number(match[1].replace(',', ''));
  }
  return null;
};

export class MockLLMProvider implements LLMProvider {
  readonly name = 'mock-semantic-v1';

  async parseUserNeed(message: string, options: LLMCallOptions = {}): Promise<unknown> {
    if (options.fault === 'timeout_once' && options.attempt === 0) throw new Error('MOCK_LLM_TIMEOUT');
    if (options.fault === 'invalid_json_once' && options.attempt === 0) return { intent: 42, malformed: true };

    const budgetMatches = [
      ...[...message.matchAll(/(?:预算|最多|不超过|别超过)[^0-9]{0,6}([0-9,]+)/gi)].map((m) => Number(m[1].replace(',', ''))),
      ...[...message.matchAll(/([0-9,]+)\s*(?:MYR|元)?以内/gi)].map((m) => Number(m[1].replace(',', '')))
    ];
    const contradictoryBudget = budgetMatches.length > 1 && new Set(budgetMatches).size > 1;
    const vehicleType: UserNeed['vehicle']['type'] = has(message, ['SUV']) ? 'SUV' : has(message, ['Hatchback']) ? 'Hatchback' : has(message, ['MPV']) ? 'MPV' : has(message, ['Sedan', '轿车']) ? 'Sedan' : 'unknown';
    const age = firstNumber(message, [/车龄\s*([0-9]+)\s*年/i, /([0-9]+)\s*年(?:内)?(?:SUV|Sedan|Hatchback|MPV)/i, /(?:SUV|Sedan|Hatchback|MPV)[^0-9]{0,3}([0-9]+)\s*年/i]);
    const maxBudget = contradictoryBudget ? null : budgetMatches[0] ?? firstNumber(message, [/([0-9,]+)\s*(?:MYR|元)(?:以内)?/i]);
    const priorities: string[] = [];
    if (has(message, ['水浸', '泡水', '水灾', '大雨', '雨季'])) priorities.push('flood');
    if (has(message, ['盗抢', '失窃', '被偷'])) priorities.push('theft');
    if (has(message, ['火灾', '失火'])) priorities.push('fire');
    if (has(message, ['道路救援', '半路趴窝', '抛锚'])) priorities.push('roadside_assistance');
    if (has(message, ['第三者', '第三方'])) priorities.push('third_party');
    if (has(message, ['个人意外', '人身意外'])) priorities.push('personal_accident');
    const missing: string[] = [];
    if (vehicleType === 'unknown') missing.push('vehicle.type');
    if (age === null) missing.push('vehicle.age_years');
    if (maxBudget === null) missing.push('budget.max_annual_premium');
    if (contradictoryBudget) missing.push('budget.conflict_requires_confirmation');
    const evidence = [
      maxBudget !== null ? `预算上限 ${maxBudget} MYR` : '',
      priorities.length ? `关注 ${priorities.join('、')}` : '',
      has(message, ['两周', '快到期']) ? '续保时间较近' : ''
    ].filter(Boolean);
    return {
      intent: has(message, ['续保', '车险', '到期']) ? 'renew_car_insurance' : 'unknown',
      vehicle: { type: vehicleType, age_years: age },
      budget: { currency: 'MYR', max_annual_premium: maxBudget },
      coverage_priorities: priorities,
      usage: has(message, ['通勤', '上下班', '上班开']) ? 'daily_commute' : has(message, ['长途', '外地']) ? 'long_distance' : has(message, ['偶尔']) ? 'occasional' : 'unknown',
      price_sensitivity: has(message, ['便宜', '价格优先', '别太贵']) ? 'high' : 'medium',
      renewal_urgency: has(message, ['两周', '快到期']) ? 'within_2_weeks' : has(message, ['月底', '一个月']) ? 'within_month' : has(message, ['两个月']) ? 'not_urgent' : 'unknown',
      missing_fields: missing,
      information_status: missing.length?'needs_clarification':'complete',
      evidence_summary: evidence
    } satisfies UserNeed;
  }

  async chooseCoupon(need: UserNeed, _profile: UserProfile, coupons: Coupon[]): Promise<unknown> {
    const chosen = coupons.filter((coupon) => coupon.discount_value > 0).sort((a,b) => b.discount_value-a.discount_value)[0];
    return {
      decision: chosen ? 'grant' : 'reject', selected_coupon_id: chosen?.coupon_id ?? null,
      discount_value: chosen?.discount_value ?? 0, currency:'MYR', eligible_product_ids: chosen?.eligible_product_ids ?? [],
      reason_codes:['LLM_PREFERENCE_HIGHEST_DISCOUNT'], rejected_coupon_ids:[], fallback_status:'none'
    };
  }

  async rankProducts(need: UserNeed, products: InsuranceProduct[], discount: number): Promise<unknown> {
    return products.map((product, index) => ({
      rank:index+1, product_id:product.product_id, product_name:product.product_name, original_premium:product.annual_premium,
      premium_after_coupon:Math.max(0,product.annual_premium-discount), match_score:Math.max(55,95-index*8),
      score_breakdown:{ coverage:60-index*4,budget:40 },
      recommendation_reasons: need.coverage_priorities.filter((x) => product.coverage_tags.includes(x)).map((x) => `语义匹配 ${x}`)
    }));
  }

  async compareProducts(products: InsuranceProduct[], pdps: PdpDocument[], discount: number): Promise<unknown> {
    const items: ComparisonItem[] = products.map((product) => {
      const text = pdpTextFor(product.product_id,pdps);
      const roadsideStated = /道路救援|道路援助/.test(text) && !/未说明道路救援|未提及道路救援|未披露道路救援/.test(text);
      const deductibleNumbers = [...text.matchAll(/(?:免赔(?:额)?(?:条款写为)?|自付额)\s*MYR\s*([0-9,]+)/g)].map((m) => Number(m[1].replace(',','')));
      const conflicts = deductibleNumbers.length > 1 && new Set(deductibleNumbers).size > 1 ? ['deductible: PDP中存在多个不同数值'] : [];
      const floodStated = /水浸|水灾/.test(text) && !/未提及水浸|未披露水浸/.test(text);
      const annualPremium=firstNumber(text,[/(?:年保费|每年|年费)\s*MYR\s*([0-9,]+)/]);
      const sumInsured=firstNumber(text,[/(?:保额|最高赔偿额|保险金额)\s*MYR\s*([0-9,]+)/]);
      return {
        product_id:product.product_id, product_name:product.product_name, insurer:product.insurer,
        annual_premium:annualPremium??'not_stated', discount_amount:discount,
        premium_after_coupon:annualPremium===null?'not_stated':annualPremium-discount,
        sum_insured:sumInsured??'not_stated',
        coverage:{collision:/碰撞/.test(text)?'covered':'not_stated',theft:/盗抢|失窃/.test(text)?'covered':'not_stated',flood:floodStated?'covered':'not_stated',fire:/火灾/.test(text)?'covered':'not_stated',natural_disaster:/自然灾害/.test(text)?'covered':'not_stated',third_party:/第三者|第三方/.test(text)?'covered':'not_stated',personal_accident:/个人意外/.test(text)?'covered':'not_stated'},
        deductible:conflicts.length?'not_stated':(deductibleNumbers[0] ?? 'not_stated'),
        roadside_assistance:roadsideStated?'included':'not_stated', term_and_waiting_period:/12个月|一年/.test(text)?'12 months; waiting period as stated':'not_stated',
        exclusions:(text.match(/主要除外：([^。]+)/)?.[1] ?? text.match(/(?:^|。)([^。]+)不保/)?.[1] ?? text.match(/(?:^|。)([^。]+)除外/)?.[1] ?? '').split(/[、,，及]/).filter(Boolean),
        claim_channel_and_documents:/理赔/.test(text)?(text.match(/([^。]*理赔[^。]*)/)?.[1] ?? 'stated in PDP'):'not_stated',
        vehicle_eligibility:text.match(/适用[0-9]+年内[^。]+/)?.[0] ?? 'not_stated', not_stated_fields:[], conflicts,
        evidence:{ premium:text.match(/[^。]*(?:年保费|每年|年费)[^。]*/)?.[0] ?? 'not_stated', sum_insured:text.match(/[^。]*(?:保额|赔偿额|保险金额)[^。]*/)?.[0] ?? 'not_stated', deductible:text.match(/[^。]*(?:免赔|自付额)[^。]*/)?.[0] ?? 'not_stated' },
        match_summary:`${product.product_name} 的字段仅依据虚构 PDP 抽取。`
      };
    });
    return { products:items, requires_manual_review:items.some((x)=>x.conflicts.length>0), fallback_status:items.some((x)=>x.conflicts.length>0)?'manual_review':'none', errors:[] } satisfies ComparisonResult;
  }
}
