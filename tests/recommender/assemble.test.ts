import { describe, expect, it } from 'vitest';

import { ErrorCode } from '@/core/errors';
import { assembleRecommendation, buildReasons } from '@/recommender/assemble';
import type { MealCandidate } from '@/types/index';

import { testProfile } from './fake-deps.js';

function scored(code: string, score: number, overrides: Partial<MealCandidate> = {}): MealCandidate {
  return { code, name: code, price: 30, effectivePrice: 30, score, breakdown: {}, ...overrides };
}

describe('buildReasons', () => {
  it('至少 2 条理由', () => {
    const reasons = buildReasons(scored('M', 0.5, { category: '汉堡' }), testProfile(), true);
    expect(reasons.length).toBeGreaterThanOrEqual(2);
  });

  it('命中偏好品类与券后节省时给出对应理由', () => {
    const reasons = buildReasons(
      scored('M', 0.5, { category: '汉堡', effectivePrice: 31, discount: 8 }),
      testProfile(),
      true,
    );
    expect(reasons.join(' ')).toContain('汉堡');
    expect(reasons.join(' ')).toContain('券后省');
  });

  it('营养缺失时标注仅供参考', () => {
    const reasons = buildReasons(scored('M', 0.5), testProfile(), false);
    expect(reasons.join(' ')).toContain('仅供参考');
  });
});

describe('assembleRecommendation', () => {
  const profile = testProfile();

  it('按分数排序，primary 最高，alternatives ≤2', () => {
    const { recommendation } = assembleRecommendation({
      candidates: [scored('A', 0.3), scored('B', 0.9), scored('C', 0.5), scored('D', 0.4)],
      profile,
      nutritionRelaxed: false,
      nutritionComplete: true,
      degraded: false,
    });
    expect(recommendation.primary.code).toBe('B');
    expect(recommendation.alternatives.map((c) => c.code)).toEqual(['C', 'D']);
    expect(recommendation.alternatives.length).toBeLessThanOrEqual(2);
    expect(recommendation.reasons.length).toBeGreaterThanOrEqual(2);
  });

  it('degraded / relaxed 传入即反映并生成提示', () => {
    const { recommendation, notices } = assembleRecommendation({
      candidates: [scored('A', 0.9)],
      profile,
      nutritionRelaxed: true,
      nutritionComplete: false,
      degraded: true,
    });
    expect(recommendation.degraded).toBe(true);
    expect(notices.join(' ')).toContain('最接近');
    expect(notices.join(' ')).toContain('离线演示数据');
  });

  it('空候选抛 EMPTY_RESULT', () => {
    expect(() =>
      assembleRecommendation({
        candidates: [],
        profile,
        nutritionRelaxed: false,
        nutritionComplete: true,
        degraded: false,
      }),
    ).toThrowError(/没有可推荐/);
    try {
      assembleRecommendation({ candidates: [], profile, nutritionRelaxed: false, nutritionComplete: true, degraded: false });
    } catch (error) {
      expect((error as { code?: string }).code).toBe(ErrorCode.EMPTY_RESULT);
    }
  });
});
