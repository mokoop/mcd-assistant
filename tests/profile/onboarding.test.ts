import { describe, expect, it } from 'vitest';

import { createDefaultProfile } from '@/profile/defaults';
import { applyOnboardingAnswers, buildOnboardingQuestions, TASTE_TAG_OPTIONS } from '@/profile/onboarding';
import { isColdStart } from '@/profile/profile';
import { parseUserProfile } from '@/profile/schema';
import type { UserProfile } from '@/types/index';

describe('buildOnboardingQuestions（冷启动引导）', () => {
  it('空画像 → coldStart 且覆盖最小必要集', () => {
    const plan = buildOnboardingQuestions(createDefaultProfile());
    expect(plan.coldStart).toBe(true);
    const keys = plan.questions.map((q) => q.key);
    expect(keys).toEqual(expect.arrayContaining(['channel', 'city', 'budget', 'tasteTags', 'nutritionGoal']));
    const taste = plan.questions.find((q) => q.key === 'tasteTags');
    expect(taste?.options).toEqual([...TASTE_TAG_OPTIONS]);
  });

  it('已具备完整画像 → 无需再问', () => {
    const profile = applyOnboardingAnswers(createDefaultProfile(), {
      city: '上海',
      channel: 'nearby',
      budget: { min: 20, max: 40 },
      tasteTags: ['辣'],
      nutritionGoal: { maxKcal: 700 },
      allergies: ['乳制品'],
    });
    const plan = buildOnboardingQuestions(profile);
    expect(plan.questions).toHaveLength(0);
    expect(plan.coldStart).toBe(false);
  });

  it('部分缺失 → 仅问缺失项', () => {
    const profile: UserProfile = {
      ...createDefaultProfile(),
      location: { city: '上海', channel: 'nearby' },
      preferences: { ...createDefaultProfile().preferences, priceBand: { min: 20, max: 40 } },
    };
    const plan = buildOnboardingQuestions(profile);
    const keys = plan.questions.map((q) => q.key);
    expect(keys).not.toContain('city');
    expect(keys).not.toContain('budget');
    expect(keys).toContain('tasteTags');
  });
});

describe('applyOnboardingAnswers', () => {
  it('合并位置/预算/口味/营养，口味去重', () => {
    const profile = applyOnboardingAnswers(createDefaultProfile(), {
      city: '上海',
      channel: 'nearby',
      budget: { min: 20, max: 40 },
      tasteTags: ['辣', '辣', '鸡'],
      nutritionGoal: { maxKcal: 700 },
    });
    expect(profile.location).toEqual({ city: '上海', channel: 'nearby' });
    expect(profile.preferences.priceBand).toEqual({ min: 20, max: 40 });
    expect(profile.preferences.taste?.tags).toEqual(['辣', '鸡']);
    expect(profile.preferences.nutritionGoal).toEqual({ maxKcal: 700 });
  });

  it('仅应用已提供字段（可跳过）', () => {
    const profile = applyOnboardingAnswers(createDefaultProfile(), { city: '北京' });
    expect(profile.location?.city).toBe('北京');
    expect(profile.preferences.taste).toBeUndefined();
    expect(profile.preferences.priceBand).toEqual({ min: 0, max: 0 });
  });

  it('答完预算后仍视为冷启动（声明预算不关闭冷启动，v1.1.0 评审修复）', () => {
    const profile = applyOnboardingAnswers(createDefaultProfile(), {
      city: '上海',
      channel: 'nearby',
      budget: { min: 20, max: 40 },
    });
    expect(profile.preferences.priceBand).toEqual({ min: 20, max: 40 });
    expect(isColdStart(profile)).toBe(true);
  });
});

describe('parseUserProfile（v1 → v2 迁移）', () => {
  it('v1 画像读取后升版为 2，保留历史与偏好', () => {
    const v1 = {
      version: 1,
      preferences: { categoryWeights: { 汉堡: 0.8 }, priceBand: { min: 20, max: 40 } },
      frequent: { storeCodes: ['S1'], timeSlots: ['lunch'] },
      history: [
        {
          timestamp: '2026-10-09T00:00:00.000Z',
          storeCode: 'S1',
          mealCode: 'M1',
          mealName: '巨无霸套餐',
          effectivePrice: 31,
          category: '汉堡',
          source: 'explicit',
        },
      ],
      updatedAt: '2026-10-09T00:00:00.000Z',
    };
    const parsed = parseUserProfile(v1);
    expect(parsed.version).toBe(2);
    expect(parsed.history).toHaveLength(1);
    expect(parsed.preferences.categoryWeights['汉堡']).toBeCloseTo(0.8);
    expect(parsed.location).toBeUndefined();
  });

  it('保留 v2 的 location/taste，剔除未知字段', () => {
    const parsed = parseUserProfile({
      version: 2,
      preferences: { categoryWeights: {}, priceBand: { min: 0, max: 0 }, taste: { tags: ['辣'] } },
      location: { city: '上海', channel: 'delivery', phone: '13800000000' },
      frequent: { storeCodes: [], timeSlots: [] },
      history: [],
      updatedAt: '2026-10-10T00:00:00.000Z',
    });
    expect(parsed.preferences.taste?.tags).toEqual(['辣']);
    expect(parsed.location?.channel).toBe('delivery');
    // 未知字段（phone）被剥离，不落盘
    expect((parsed.location as Record<string, unknown>).phone).toBeUndefined();
  });
});
