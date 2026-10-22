import { describe, expect, it } from 'vitest';

import {
  applyNegativeSignal,
  deriveTimeSlot,
  mergeTasteTags,
  normalizeWeights,
  updateCategoryWeights,
  updateMealTypePreference,
  updatePriceBand,
} from '@/profile/ema';

describe('normalizeWeights', () => {
  it('使权重之和为 1', () => {
    const result = normalizeWeights({ a: 2, b: 2 });
    expect(result.a).toBeCloseTo(0.5);
    expect(result.b).toBeCloseTo(0.5);
  });

  it('丢弃非正值并处理空输入', () => {
    expect(normalizeWeights({})).toEqual({});
    expect(normalizeWeights({ a: 0, b: -1 })).toEqual({});
  });
});

describe('updateCategoryWeights', () => {
  it('首次命中品类权重为 1', () => {
    expect(updateCategoryWeights({}, 'burger', 0.4)).toEqual({ burger: 1 });
  });

  it('按 EMA 衰减旧品类并归一化', () => {
    const next = updateCategoryWeights({ burger: 1 }, 'fries', 0.4);
    expect(next.burger).toBeCloseTo(0.6);
    expect(next.fries).toBeCloseTo(0.4);
  });

  it('重复命中同品类保持归一化', () => {
    const next = updateCategoryWeights({ burger: 1 }, 'burger', 0.4);
    expect(next.burger).toBeCloseTo(1);
    expect(Object.keys(next)).toEqual(['burger']);
  });
});

describe('updatePriceBand', () => {
  it('首次选择以带宽比初始化价格带', () => {
    expect(updatePriceBand({ min: 0, max: 0 }, 20, 0.4, 0.2)).toEqual({ min: 16, max: 24 });
  });

  it('以价格带中心做 EMA 滑动更新', () => {
    const next = updatePriceBand({ min: 16, max: 24 }, 30, 0.4, 0.2);
    expect(next.min).toBeCloseTo(19.2);
    expect(next.max).toBeCloseTo(28.8);
  });
});

describe('updateMealTypePreference', () => {
  it('首次命中餐次权重为 1', () => {
    expect(updateMealTypePreference(undefined, 'lunch', 0.4)).toEqual({ lunch: 1, dinner: 0 });
  });

  it('按 EMA 更新并归一化', () => {
    const next = updateMealTypePreference({ lunch: 1, dinner: 0 }, 'dinner', 0.4);
    expect(next.lunch).toBeCloseTo(0.6);
    expect(next.dinner).toBeCloseTo(0.4);
  });
});

describe('deriveTimeSlot', () => {
  const ZONE = 'Asia/Shanghai';

  it.each([
    // UTC（Z）时间戳 → 上海本地（UTC+8）
    ['2026-10-10T00:00:00.000Z', 'breakfast'], // 08:00
    ['2026-10-10T02:59:00.000Z', 'breakfast'], // 10:59
    ['2026-10-10T03:00:00.000Z', 'lunch'], // 11:00（下边界）
    ['2026-10-10T04:30:00.000Z', 'lunch'], // 12:30（午餐）
    ['2026-10-10T06:59:00.000Z', 'lunch'], // 14:59（上边界）
    ['2026-10-10T07:00:00.000Z', 'afternoon'], // 15:00
    ['2026-10-10T09:00:00.000Z', 'dinner'], // 17:00
    ['2026-10-10T13:59:00.000Z', 'dinner'], // 21:59
    ['2026-10-10T14:00:00.000Z', 'night'], // 22:00
    ['2026-10-10T20:00:00.000Z', 'night'], // 次日 04:00
    ['2026-10-10T21:00:00.000Z', 'breakfast'], // 次日 05:00
  ])('UTC 时间戳 %s 在上海时区归类为 %s', (timestamp, slot) => {
    expect(deriveTimeSlot(timestamp, ZONE)).toBe(slot);
  });

  it('带 +08:00 偏移的时间戳与等价 UTC 时刻归类一致', () => {
    expect(deriveTimeSlot('2026-10-10T12:30:00+08:00', ZONE)).toBe('lunch');
    expect(deriveTimeSlot('2026-10-10T12:30:00+08:00', ZONE)).toBe(
      deriveTimeSlot('2026-10-10T04:30:00.000Z', ZONE),
    );
  });

  it('同一时刻在不同时区归类不同（时区确实生效）', () => {
    expect(deriveTimeSlot('2026-10-10T16:30:00.000Z', 'America/New_York')).toBe('lunch'); // 12:30 EDT
    expect(deriveTimeSlot('2026-10-10T16:30:00.000Z', ZONE)).toBe('night'); // 次日 00:30
  });

  it('无法解析或非法时区时返回 null', () => {
    expect(deriveTimeSlot('not-a-timestamp', ZONE)).toBeNull();
    expect(deriveTimeSlot('2026-10-10T04:30:00.000Z', 'Not/AZone')).toBeNull();
  });
});

describe('applyNegativeSignal（v1.1.0 负反馈）', () => {
  it('衰减命中考品类并归一化', () => {
    const next = applyNegativeSignal({ 汉堡: 0.7, 轻食: 0.3 }, '汉堡', 0.5);
    // 汉堡：0.7·(1-0.5)=0.35，轻食：0.3 → 归一化后汉堡下降
    expect(next['汉堡']).toBeLessThan(0.7);
    expect((next['汉堡'] ?? 0) + (next['轻食'] ?? 0)).toBeCloseTo(1);
  });

  it('强衰减可使命中考品类低于其他品类', () => {
    const next = applyNegativeSignal({ 汉堡: 0.7, 轻食: 0.3 }, '汉堡', 0.7);
    expect(next['汉堡'] ?? 0).toBeLessThan(next['轻食'] ?? 0);
  });

  it('非法 beta 或未知品类 → 原样返回', () => {
    const weights = { 汉堡: 1 };
    expect(applyNegativeSignal(weights, '汉堡', 0)).toBe(weights);
    expect(applyNegativeSignal(weights, '汉堡', 1)).toBe(weights);
    expect(applyNegativeSignal(weights, '不存在', 0.3)).toBe(weights);
  });

  it('衰减后不产生负数/NaN', () => {
    const next = applyNegativeSignal({ a: 1, b: 1 }, 'a', 0.3);
    for (const value of Object.values(next)) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('mergeTasteTags（v1.1.0 口味标签）', () => {
  it('追加去重并保留顺序', () => {
    expect(mergeTasteTags(['辣'], ['鸡', '辣'], [])).toEqual(['辣', '鸡']);
  });

  it('先移除再加入', () => {
    expect(mergeTasteTags(['辣', '鸡'], ['清淡'], ['辣'])).toEqual(['鸡', '清淡']);
  });

  it('忽略空标签', () => {
    expect(mergeTasteTags([], ['', '牛'], [])).toEqual(['牛']);
  });
});
