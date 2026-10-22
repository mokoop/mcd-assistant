import { describe, expect, it } from 'vitest';

import { filterCandidates } from '@/recommender/filter';
import type { MealCandidate } from '@/types/index';

import { testProfile } from './fake-deps.js';

function candidate(overrides: Partial<MealCandidate>): MealCandidate {
  return { code: 'M', name: '套餐', price: 30, effectivePrice: 30, score: 0, breakdown: {}, ...overrides };
}

describe('filterCandidates', () => {
  it('剔除无有效价格（不可售）项', () => {
    const result = filterCandidates(
      [candidate({ code: 'A', price: 30 }), candidate({ code: 'B', price: 0 })],
      testProfile(),
    );
    expect(result.candidates.map((c) => c.code)).toEqual(['A']);
    expect(result.nutritionRelaxed).toBe(false);
  });

  it('maxKcal 超限项被过滤（未知热量保留）', () => {
    const profile = testProfile({
      preferences: { categoryWeights: {}, priceBand: { min: 0, max: 0 }, nutritionGoal: { maxKcal: 500 } },
    });
    const result = filterCandidates(
      [
        candidate({ code: 'A', nutrition: { energyKcal: 400 } }),
        candidate({ code: 'B', nutrition: { energyKcal: 900 } }),
        candidate({ code: 'C' }),
      ],
      profile,
    );
    expect(result.candidates.map((c) => c.code).sort()).toEqual(['A', 'C']);
    expect(result.nutritionRelaxed).toBe(false);
  });

  it('无满足项 → 回退最接近项（按热量升序）并置 relaxed', () => {
    const profile = testProfile({
      preferences: { categoryWeights: {}, priceBand: { min: 0, max: 0 }, nutritionGoal: { maxKcal: 100 } },
    });
    const result = filterCandidates(
      [candidate({ code: 'A', nutrition: { energyKcal: 900 } }), candidate({ code: 'B', nutrition: { energyKcal: 700 } })],
      profile,
    );
    expect(result.nutritionRelaxed).toBe(true);
    expect(result.candidates.map((c) => c.code)).toEqual(['B', 'A']);
  });

  it('全部不可售 → 空且非 relaxed', () => {
    expect(filterCandidates([candidate({ code: 'B', price: 0 })], testProfile())).toEqual({
      candidates: [],
      nutritionRelaxed: false,
      dietaryRelaxed: false,
    });
  });
});
