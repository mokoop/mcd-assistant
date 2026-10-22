import { describe, expect, it } from 'vitest';

import { isLateNight, localHour, resolveScene, sceneLabel, sceneWeights, SCENE_WEIGHTS } from '@/recommender/scene';

describe('isLateNight', () => {
  it.each([
    [0, true],
    [3, true],
    [4, true],
    [5, false],
    [12, false],
    [21, false],
    [22, true],
    [23, true],
  ])('%i 点 → %s', (hour, expected) => {
    expect(isLateNight(hour)).toBe(expected);
  });
});

describe('localHour', () => {
  it('按指定时区换算本地小时', () => {
    const at = new Date('2026-10-10T04:30:00.000Z');
    expect(localHour(at, 'Asia/Shanghai')).toBe(12);
    expect(localHour(at, 'UTC')).toBe(4);
  });
});

describe('resolveScene', () => {
  it('显式场景原样返回（与时间无关）', () => {
    expect(resolveScene('save', new Date('2026-10-10T12:00:00.000Z'), 'UTC')).toBe('save');
    expect(resolveScene('fit', new Date('2026-10-10T22:30:00.000Z'), 'UTC')).toBe('fit');
  });

  it('auto：深夜返回 late，其余返回 undefined', () => {
    expect(resolveScene('auto', new Date('2026-10-10T22:30:00.000Z'), 'UTC')).toBe('late');
    expect(resolveScene('auto', new Date('2026-10-10T12:00:00.000Z'), 'UTC')).toBeUndefined();
  });

  it('未知场景取值 → 返回 undefined（不静默透传非法值）', () => {
    expect(resolveScene('banana' as never, new Date('2026-10-10T12:00:00.000Z'), 'UTC')).toBeUndefined();
  });
});

describe('SCENE_WEIGHTS', () => {
  it('每个场景权重之和为 1', () => {
    for (const [scene, weights] of Object.entries(SCENE_WEIGHTS)) {
      const sum = Object.values(weights).reduce((a, b) => a + b, 0);
      expect(sum, scene).toBeCloseTo(1, 6);
    }
  });

  it('省钱优先提高性价比权重', () => {
    expect(sceneWeights('save')?.value).toBeGreaterThan(SCENE_WEIGHTS.quick.value);
  });

  it('减脂控卡提高营养权重', () => {
    expect(sceneWeights('fit')?.nutrition).toBeGreaterThan(SCENE_WEIGHTS.save.nutrition);
  });

  it('无场景返回 undefined；标签可用', () => {
    expect(sceneWeights(undefined)).toBeUndefined();
    expect(sceneLabel('save')).toBe('省钱优先');
    expect(sceneLabel(undefined)).toBe('');
  });
});
