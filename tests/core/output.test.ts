import { describe, expect, it } from 'vitest';

import { composeText, money, renderCoupons, renderProfileSummary, renderRecommendation } from '@/output';
import type { ProfileSummary } from '@/profile/index';
import type { CouponInfo, MealCandidate, Recommendation } from '@/types/index';

function primary(): MealCandidate {
  return {
    code: 'M001',
    name: '巨无霸套餐',
    price: 39,
    effectivePrice: 31,
    discount: 8,
    category: '汉堡',
    nutrition: { energyKcal: 590 },
    score: 0.8,
    breakdown: {},
  };
}

function recommendation(): Recommendation {
  return {
    primary: primary(),
    alternatives: [{ code: 'M002', name: '双层吉士堡套餐', price: 33, effectivePrice: 25, score: 0.6, breakdown: {} }],
    reasons: ['符合你偏好的「汉堡」口味', '券后省 ¥8.00'],
    generatedAt: '2026-10-10T00:00:00.000Z',
    degraded: false,
  };
}

describe('money', () => {
  it('格式化为两位小数', () => {
    expect(money(31)).toBe('¥31.00');
    expect(money(25.5)).toBe('¥25.50');
  });
});

describe('renderRecommendation', () => {
  it('包含名称、券后价、理由、备选与提示', () => {
    const text = renderRecommendation(recommendation(), ['价格仅供参考']);
    expect(text).toContain('巨无霸套餐');
    expect(text).toContain('券后价 ¥31.00');
    expect(text).toContain('省 ¥8.00');
    expect(text).toContain('理由：');
    expect(text).toContain('符合你偏好的「汉堡」口味');
    expect(text).toContain('双层吉士堡套餐');
    expect(text).toContain('价格仅供参考');
  });
});

describe('renderProfileSummary', () => {
  it('包含脱敏摘要文本', () => {
    const summary: ProfileSummary = {
      updatedAt: 't',
      totalChoices: 2,
      topCategories: [],
      priceBand: { min: 0, max: 0 },
      frequentStores: [],
      frequentTimeSlots: [],
      text: '共记录 2 次选择',
    };
    expect(renderProfileSummary(summary)).toContain('共记录 2 次选择');
  });
});

describe('renderCoupons', () => {
  it('空列表给出提示，非空列出券名', () => {
    expect(renderCoupons([])).toContain('暂未发现');
    const coupons: CouponInfo[] = [{ couponId: 'C1', name: '立减8', discount: '8' }];
    expect(renderCoupons(coupons)).toContain('立减8');
  });
});

describe('composeText', () => {
  it('过滤空段并按空行拼接', () => {
    expect(composeText(['A', undefined, '', 'B'])).toBe('A\n\nB');
  });
});
