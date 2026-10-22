import { describe, expect, it } from 'vitest';

import {
  nutritionFit,
  noveltyFit,
  priceBandFit,
  priceRangeOf,
  recentCategories,
  scoreCandidate,
  valueFit,
} from '@/recommender/score';
import type { MealCandidate } from '@/types/index';

import { testProfile } from './fake-deps.js';

function candidate(overrides: Partial<MealCandidate> = {}): MealCandidate {
  return { code: 'M', name: '套餐', price: 30, effectivePrice: 30, score: 0, breakdown: {}, ...overrides };
}

describe('维度函数', () => {
  it('priceBandFit：带内=1，带外衰减，未建立=0.5', () => {
    const band = { min: 20, max: 40 };
    expect(priceBandFit(30, band)).toBe(1);
    expect(priceBandFit(10, band)).toBeLessThan(1);
    expect(priceBandFit(10, band)).toBeGreaterThanOrEqual(0);
    expect(priceBandFit(30, { min: 0, max: 0 })).toBe(0.5);
  });

  it('valueFit：最便宜=1，最贵=0，区间相等=1', () => {
    expect(valueFit(20, { min: 20, max: 40 })).toBe(1);
    expect(valueFit(40, { min: 20, max: 40 })).toBe(0);
    expect(valueFit(20, { min: 20, max: 20 })).toBe(1);
  });

  it('nutritionFit：无目标=0.5，符合=1，超限/缺口衰减', () => {
    expect(nutritionFit({ energyKcal: 500 }, undefined)).toBe(0.5);
    expect(nutritionFit({ energyKcal: 500 }, { maxKcal: 600 })).toBe(1);
    expect(nutritionFit({ energyKcal: 900 }, { maxKcal: 600 })).toBeCloseTo(0.5, 5);
    expect(nutritionFit({ protein: 10 }, { minProtein: 20 })).toBeCloseTo(0.5, 5);
    expect(nutritionFit(undefined, { maxKcal: 600 })).toBe(0.5);
  });

  it('noveltyFit：近期已选品类按次数降权', () => {
    expect(noveltyFit('汉堡', [])).toBe(1);
    expect(noveltyFit('汉堡', ['汉堡'])).toBeCloseTo(0.6, 6);
    expect(noveltyFit('汉堡', ['汉堡', '汉堡'])).toBeCloseTo(0.2, 6);
    expect(noveltyFit(undefined, ['汉堡'])).toBe(1);
  });

  it('recentCategories 只取窗口内带品类的记录', () => {
    const profile = testProfile({
      history: [
        { timestamp: 't', storeCode: 'S', mealCode: 'M1', mealName: 'a', effectivePrice: 10, category: '汉堡', source: 'explicit' },
        { timestamp: 't', storeCode: 'S', mealCode: 'M2', mealName: 'b', effectivePrice: 10, source: 'explicit' },
        { timestamp: 't', storeCode: 'S', mealCode: 'M3', mealName: 'c', effectivePrice: 10, category: '轻食', source: 'explicit' },
      ],
    });
    expect(recentCategories(profile, 1)).toEqual(['汉堡']);
    expect(recentCategories(profile, 10)).toEqual(['汉堡', '轻食']);
  });

  it('priceRangeOf 取券后价极值', () => {
    expect(priceRangeOf([candidate({ effectivePrice: 20 }), candidate({ effectivePrice: 35 })])).toEqual({ min: 20, max: 35 });
    expect(priceRangeOf([])).toEqual({ min: 0, max: 0 });
  });
});

describe('scoreCandidate', () => {
  const weights = { category: 0.35, price: 0.2, nutrition: 0.15, value: 0.2, novelty: 0.1, taste: 0.1, popularity: 0 };

  it('breakdown 各分量之和等于 score', () => {
    const profile = testProfile({ preferences: { categoryWeights: { 汉堡: 1 }, priceBand: { min: 20, max: 40 } } });
    const { score, breakdown } = scoreCandidate({
      candidate: candidate({ category: '汉堡', effectivePrice: 30 }),
      profile,
      weights,
      recentCategories: [],
      priceRange: { min: 30, max: 30 },
    });
    const sum = Object.values(breakdown).reduce((a, b) => a + b, 0);
    expect(score).toBeCloseTo(sum, 6);
    expect(breakdown.category).toBeCloseTo(0.35, 6);
  });

  it('偏好品类得分高于无偏好品类', () => {
    const profile = testProfile({ preferences: { categoryWeights: { 汉堡: 1 }, priceBand: { min: 0, max: 0 } } });
    const preferred = scoreCandidate({
      candidate: candidate({ category: '汉堡' }),
      profile,
      weights,
      recentCategories: [],
      priceRange: { min: 30, max: 30 },
    });
    const other = scoreCandidate({
      candidate: candidate({ category: '轻食' }),
      profile,
      weights,
      recentCategories: [],
      priceRange: { min: 30, max: 30 },
    });
    expect(preferred.score).toBeGreaterThan(other.score);
  });
});
