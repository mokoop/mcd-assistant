import { describe, expect, it } from 'vitest';

import { ErrorCode } from '@/core/errors';
import { recommend } from '@/recommender/index';
import type { MealItem } from '@/types/index';

import { createFakeDeps, testProfile } from './fake-deps.js';

describe('recommend 端到端', () => {
  it('默认走麦乐送，返回主推 + ≤2 备选 + ≥2 理由', async () => {
    const { deps, calls } = createFakeDeps();
    const result = await recommend({}, deps);

    expect(result.channel).toBe('delivery');
    expect(result.store.storeCode).toBe('S1');
    expect(result.recommendation.primary.code).toBeTruthy();
    expect(result.recommendation.alternatives.length).toBeLessThanOrEqual(2);
    expect(result.recommendation.reasons.length).toBeGreaterThanOrEqual(2);
    expect(result.recommendation.degraded).toBe(false);
    expect(calls.queryMeals).toBe(1);
    expect(calls.calculatePrice).toBeLessThanOrEqual(5);
  });

  it('任一依赖降级 → degraded 传播到 Recommendation', async () => {
    const { deps } = createFakeDeps({
      listNutritionFoods: async () => ({ data: [], degraded: true }),
    });
    const result = await recommend({}, deps);
    expect(result.recommendation.degraded).toBe(true);
    expect(result.notices.join(' ')).toContain('离线');
  });

  it('Top-K 试算受 M 上限约束', async () => {
    const meals: Record<string, MealItem> = {};
    for (let i = 1; i <= 8; i += 1) {
      meals[`P${i}`] = { code: `P${i}`, name: `套餐${i}`, price: 30, category: '汉堡' };
    }
    let trials = 0;
    const { deps } = createFakeDeps({
      queryMeals: async () => ({ data: { meals }, degraded: false }),
      calculatePrice: async () => {
        trials += 1;
        return { data: { originalPrice: 30, discount: 8, price: 22 }, degraded: false };
      },
    });
    await recommend({ config: { topK: 5, maxTrials: 5 } }, deps);
    expect(trials).toBe(5);
  });

  it('R3：终评/组装仅基于 Top-K，非 Top-K 候选不会成为未计券的 primary', async () => {
    const meals: Record<string, MealItem> = {
      A: { code: 'A', name: 'A汉堡套餐', price: 40, category: '汉堡' },
      B: { code: 'B', name: 'B汉堡套餐', price: 38, category: '汉堡' },
      C: { code: 'C', name: 'C轻食套餐', price: 30, category: '轻食' },
      D: { code: 'D', name: 'D轻食套餐', price: 28, category: '轻食' },
    };
    const profile = testProfile({
      preferences: { categoryWeights: { 汉堡: 1, 轻食: 0 }, priceBand: { min: 0, max: 100 } },
    });
    const { deps } = createFakeDeps({
      queryMeals: async () => ({ data: { meals }, degraded: false }),
      calculatePrice: async (q) => {
        const price = meals[q.items[0]?.productCode ?? '']?.price ?? 0;
        return { data: { originalPrice: price, discount: 8, price: price - 8 }, degraded: false };
      },
    });

    const result = await recommend({ profile, config: { topK: 2, maxTrials: 2 } }, deps);
    const assembled = [result.recommendation.primary, ...result.recommendation.alternatives];

    // 组装集合 ⊆ Top-K（汉堡），且每个都含券后价（discount>0）
    expect(assembled.every((c) => c.code === 'A' || c.code === 'B')).toBe(true);
    expect(assembled.every((c) => (c.discount ?? 0) > 0)).toBe(true);
    expect(['C', 'D']).not.toContain(result.recommendation.primary.code);
  });

  it('多样性降权会改变主推（近期已选品类降权）', async () => {
    const meals: Record<string, MealItem> = {
      X: { code: 'X', name: '汉堡餐', price: 35, category: '汉堡' },
      Y: { code: 'Y', name: '沙拉餐', price: 35, category: '轻食' },
    };
    const base = {
      categoryWeights: { 汉堡: 0.5, 轻食: 0.5 },
      priceBand: { min: 30, max: 40 },
    };
    const burgerRecord = {
      timestamp: 't',
      storeCode: 'S1',
      mealCode: 'X',
      mealName: '汉堡餐',
      effectivePrice: 35,
      category: '汉堡',
      source: 'explicit' as const,
    };

    const { deps } = createFakeDeps({
      queryMeals: async () => ({ data: { meals }, degraded: false }),
      calculatePrice: async () => ({ data: { originalPrice: 35, discount: 8, price: 27 }, degraded: false }),
    });

    const fresh = await recommend({ profile: testProfile({ preferences: base, history: [] }) }, deps);
    const repeated = await recommend(
      { profile: testProfile({ preferences: base, history: [burgerRecord, burgerRecord] }) },
      deps,
    );

    expect(fresh.recommendation.primary.category).toBe('汉堡');
    expect(repeated.recommendation.primary.category).toBe('轻食');
  });

  it('营养数据缺失 → 理由/提示标注仅供参考', async () => {
    const { deps } = createFakeDeps({ listNutritionFoods: async () => ({ data: [], degraded: false }) });
    const result = await recommend({}, deps);
    expect(result.notices.join(' ')).toContain('仅供参考');
  });

  it('无可售餐品 → EMPTY_RESULT', async () => {
    const { deps } = createFakeDeps({ queryMeals: async () => ({ data: { meals: {} }, degraded: false }) });
    await expect(recommend({}, deps)).rejects.toMatchObject({ code: ErrorCode.EMPTY_RESULT });
  });

  it('无配送地址 → 回退附近门店', async () => {
    const { deps, calls } = createFakeDeps({
      deliveryQueryAddresses: async () => ({ data: [], degraded: false }),
    });
    const result = await recommend({}, deps);
    expect(result.channel).toBe('nearby');
    expect(calls.queryNearbyStores).toBe(1);
  });

  it('显式 storeCode 时跳过门店检索', async () => {
    const { deps, calls } = createFakeDeps();
    const result = await recommend({ storeCode: 'S9', beCode: '2' }, deps);
    expect(result.store.storeCode).toBe('S9');
    expect(calls.deliveryQueryAddresses).toBe(0);
    expect(calls.queryNearbyStores).toBe(0);
  });
});
