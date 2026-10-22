import { describe, expect, it } from 'vitest';

import { resolveRecommenderConfig } from '@/recommender/config';
import { applyCouponPricing, couponValue, dedupeCoupons, pickBestCoupon } from '@/recommender/coupons';
import type { CouponInfo, MealCandidate, StoreInfo } from '@/types/index';

import { createFakeDeps } from './fake-deps.js';

function candidate(code: string, price: number): MealCandidate {
  return { code, name: code, price, effectivePrice: price, score: 0, breakdown: {} };
}

const store: StoreInfo = { storeCode: 'S1', beCode: '2' };

describe('券工具', () => {
  it('dedupeCoupons 按 id/code/name 去重', () => {
    const coupons: CouponInfo[] = [
      { couponId: 'C1', discount: '5' },
      { couponId: 'C1', discount: '5' },
      { couponCode: 'X', discount: '3' },
    ];
    expect(dedupeCoupons(coupons)).toHaveLength(2);
  });

  it('couponValue 解析面额数值', () => {
    expect(couponValue({ discount: '8' })).toBe(8);
    expect(couponValue({ discount: '¥5.5' })).toBe(5.5);
    expect(couponValue({})).toBe(0);
  });

  it('pickBestCoupon 选面额最大者，空券返回 undefined', () => {
    expect(pickBestCoupon([])).toBeUndefined();
    expect(pickBestCoupon([{ couponId: 'A', discount: '5' }, { couponId: 'B', discount: '8' }])?.couponId).toBe('B');
  });
});

describe('applyCouponPricing', () => {
  it('对 Top-K 试算并写回券后价，试算次数 ≤ M', async () => {
    const { deps, calls } = createFakeDeps();
    const topCandidates = [candidate('M001', 39), candidate('M002', 33), candidate('M003', 35), candidate('M004', 25)];
    const result = await applyCouponPricing({
      deps,
      store,
      channel: 'delivery',
      topCandidates,
      config: { ...resolveRecommenderConfig(), maxTrials: 2 },
    });
    expect(result.trials).toBe(2);
    expect(calls.calculatePrice).toBe(2);
    // 前两项命中 8 元券
    expect(topCandidates[0]?.effectivePrice).toBe(31);
    expect(topCandidates[0]?.discount).toBe(8);
    // 未试算项保留原价
    expect(topCandidates[3]?.effectivePrice).toBe(25);
  });

  it('无可用券则不试算、不改变价格', async () => {
    const { deps, calls } = createFakeDeps({
      availableCoupons: async () => ({ data: [], degraded: false }),
      queryStoreCoupons: async () => ({ data: [], degraded: false }),
      queryMyCoupons: async () => ({ data: [], degraded: false }),
    });
    const topCandidates = [candidate('M001', 39)];
    const result = await applyCouponPricing({
      deps,
      store,
      channel: 'delivery',
      topCandidates,
      config: resolveRecommenderConfig(),
    });
    expect(result.trials).toBe(0);
    expect(calls.calculatePrice).toBe(0);
    expect(topCandidates[0]?.effectivePrice).toBe(39);
  });

  it('任一券查询降级 → degraded=true', async () => {
    const { deps } = createFakeDeps({
      queryMyCoupons: async () => ({ data: [], degraded: true }),
    });
    const result = await applyCouponPricing({
      deps,
      store,
      channel: 'delivery',
      topCandidates: [candidate('M001', 39)],
      config: resolveRecommenderConfig(),
    });
    expect(result.degraded).toBe(true);
  });

  it('试算抛错时保留原价且计入试算次数', async () => {
    let attempts = 0;
    const { deps } = createFakeDeps({
      calculatePrice: async () => {
        attempts += 1;
        throw new Error('boom');
      },
    });
    const topCandidates = [candidate('M001', 39)];
    const result = await applyCouponPricing({
      deps,
      store,
      channel: 'delivery',
      topCandidates,
      config: resolveRecommenderConfig(),
    });
    expect(result.trials).toBe(1);
    expect(attempts).toBe(1);
    expect(topCandidates[0]?.effectivePrice).toBe(39);
  });
});
