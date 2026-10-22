import { describe, expect, it } from 'vitest';

import { parseThresholdCoupon, suggestBundle } from '@/recommender/bundle';
import { DEFAULT_RECOMMENDER_CONFIG } from '@/recommender/config';
import type { MealCandidate } from '@/types/index';

function candidate(code: string, price: number, effectivePrice = price): MealCandidate {
  return { code, name: `套餐${code}`, price, effectivePrice, score: 0, breakdown: {} };
}

describe('parseThresholdCoupon（满减券解析）', () => {
  it('解析「满 X 减 Y」', () => {
    expect(parseThresholdCoupon({ name: '满30减5' })).toEqual({ threshold: 30, amount: 5, text: '满30减5' });
    expect(parseThresholdCoupon({ discount: '满 50 减 20' })?.threshold).toBe(50);
  });

  it('非满减券返回 undefined', () => {
    expect(parseThresholdCoupon({ name: '立减8', discount: '8' })).toBeUndefined();
    expect(parseThresholdCoupon({ name: '5折' })).toBeUndefined();
    expect(parseThresholdCoupon({})).toBeUndefined();
  });
});

describe('suggestBundle（凑单建议）', () => {
  const coupons = [{ couponId: 'C1', name: '满30减5', discount: '5' }];

  it('净省 > 0 时给出建议（选满足区间的最低价加购项）', () => {
    const primary = candidate('P', 28); // 差 2 元到 30；券面额 5
    const suggestion = suggestBundle({
      primary,
      candidates: [primary, candidate('F1', 4), candidate('F2', 3), candidate('F3', 40)],
      coupons,
      config: DEFAULT_RECOMMENDER_CONFIG,
    });
    expect(suggestion).toBeDefined();
    expect(suggestion?.addCode).toBe('F2'); // 价 3 ∈ [2,5) 且最小
    expect(suggestion?.bundlePay).toBe(26); // 28 + 3 - 5
    expect(suggestion?.saved).toBe(2);
  });

  it('无净省（gap ≥ 券面额）→ 不建议', () => {
    const primary = candidate('P', 28);
    const suggestion = suggestBundle({
      primary,
      candidates: [primary, candidate('F', 3)],
      coupons: [{ name: '满30减2' }],
      config: DEFAULT_RECOMMENDER_CONFIG,
    });
    expect(suggestion).toBeUndefined();
  });

  it('差额超出窗口 → 不建议', () => {
    const primary = candidate('P', 5); // 差 25 > 20
    const suggestion = suggestBundle({
      primary,
      candidates: [primary, candidate('F', 26)],
      coupons,
      config: DEFAULT_RECOMMENDER_CONFIG,
    });
    expect(suggestion).toBeUndefined();
  });

  it('无可解析满减券 / 无合适加购项 → undefined（不报错）', () => {
    const primary = candidate('P', 28);
    expect(
      suggestBundle({ primary, candidates: [primary], coupons: [{ name: '立减8' }], config: DEFAULT_RECOMMENDER_CONFIG }),
    ).toBeUndefined();
    expect(
      suggestBundle({ primary, candidates: [primary], coupons, config: DEFAULT_RECOMMENDER_CONFIG }),
    ).toBeUndefined();
  });

  it('主推原价已达门槛（券已生效）→ 不建议（按原价判定，避免重复计券）', () => {
    // 原价 52 ≥ 门槛 50，券已生效（券后 42）；再凑单无益
    const primary = candidate('P', 52, 42);
    const suggestion = suggestBundle({
      primary,
      candidates: [primary, candidate('F', 8)],
      coupons: [{ couponId: 'C1', name: '满50减10', discount: '10' }],
      config: DEFAULT_RECOMMENDER_CONFIG,
    });
    expect(suggestion).toBeUndefined();
  });

  it('excludeCoupon：已被主推使用的券不再计入', () => {
    const primary = candidate('P', 28);
    const coupon = { couponId: 'C1', name: '满30减5', discount: '5' };
    const suggestion = suggestBundle({
      primary,
      candidates: [primary, candidate('F', 3)],
      coupons: [coupon],
      excludeCoupon: coupon,
      config: DEFAULT_RECOMMENDER_CONFIG,
    });
    expect(suggestion).toBeUndefined();
  });
});
