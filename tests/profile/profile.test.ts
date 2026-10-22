import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_PROFILE_CONFIG } from '@/profile/config';
import { createDefaultProfile } from '@/profile/defaults';
import {
  applyChoice,
  applyProfilePatch,
  buildStartingProfile,
  getProfileSummary,
  readProfile,
  recordChoice,
  resetProfile,
  saveProfile,
} from '@/profile/index';
import { createProfileStore } from '@/profile/store';
import type { ChoiceRecord, ChoiceSource, MealCandidate } from '@/types/index';

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mcd-profile-api-'));
  file = join(dir, 'profile.json');
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

function choice(overrides: Partial<ChoiceRecord> = {}): ChoiceRecord {
  return {
    timestamp: '2026-10-10T12:30:00+08:00',
    storeCode: 'S1001',
    mealCode: 'M1',
    mealName: '巨无霸套餐',
    effectivePrice: 20,
    category: 'burger',
    source: 'explicit',
    ...overrides,
  };
}

function candidate(overrides: Partial<MealCandidate> = {}): MealCandidate {
  return {
    code: 'M1',
    name: '巨无霸套餐',
    category: 'burger',
    price: 25,
    effectivePrice: 20,
    score: 1,
    breakdown: {},
    ...overrides,
  };
}

/** 显式指定时区，保证就餐时段归类可复现（不依赖运行环境 TZ） */
const CONFIG = { ...DEFAULT_PROFILE_CONFIG, timeZone: 'Asia/Shanghai' };

function weighted(categories: string[], source: ChoiceSource) {
  return categories.reduce(
    (profile, category) => applyChoice(profile, choice({ category, source }), CONFIG),
    createDefaultProfile(),
  );
}

describe('applyChoice', () => {
  it('为纯函数，不修改入参画像', () => {
    const base = createDefaultProfile();
    applyChoice(base, choice(), CONFIG);
    expect(base.history).toHaveLength(0);
    expect(base.preferences.categoryWeights).toEqual({});
  });

  it('明确选择使用强权重 α_strong', () => {
    const profile = weighted(['burger', 'fries'], 'explicit');
    expect(profile.preferences.categoryWeights.burger).toBeCloseTo(0.6);
    expect(profile.preferences.categoryWeights.fries).toBeCloseTo(0.4);
  });

  it('未明确选择使用弱权重 α_weak', () => {
    const profile = weighted(['burger', 'fries'], 'recommended');
    expect(profile.preferences.categoryWeights.burger).toBeCloseTo(0.85);
    expect(profile.preferences.categoryWeights.fries).toBeCloseTo(0.15);
  });

  it('滑动更新价格带并记录常点门店/时段', () => {
    const profile = applyChoice(createDefaultProfile(), choice(), CONFIG);
    expect(profile.preferences.priceBand).toEqual({ min: 16, max: 24 });
    expect(profile.frequent.storeCodes).toEqual(['S1001']);
    expect(profile.frequent.timeSlots).toEqual(['lunch']);
    expect(profile.preferences.mealTypePreference).toEqual({ lunch: 1, dinner: 0 });
  });

  it('按用户本地时区归类（UTC 时间戳 04:30Z = 上海 12:30 → lunch，回归 R1）', () => {
    const profile = applyChoice(
      createDefaultProfile(),
      choice({ timestamp: '2026-10-10T04:30:00.000Z' }),
      CONFIG,
    );
    expect(profile.frequent.timeSlots).toEqual(['lunch']);
    expect(profile.preferences.mealTypePreference).toEqual({ lunch: 1, dinner: 0 });
  });

  it('按用户本地时区归类（UTC 时间戳 11:30Z = 上海 19:30 → dinner）', () => {
    const profile = applyChoice(
      createDefaultProfile(),
      choice({ timestamp: '2026-10-10T11:30:00.000Z' }),
      CONFIG,
    );
    expect(profile.frequent.timeSlots).toEqual(['dinner']);
    expect(profile.preferences.mealTypePreference).toEqual({ lunch: 0, dinner: 1 });
  });

  it('常点门店去重并保持最近优先', () => {
    const profile = ['A', 'B', 'A'].reduce(
      (acc, storeCode) => applyChoice(acc, choice({ storeCode }), CONFIG),
      createDefaultProfile(),
    );
    expect(profile.frequent.storeCodes).toEqual(['A', 'B']);
  });

  it('history 截断至最近 50 条且最新在前', () => {
    let profile = createDefaultProfile();
    for (let index = 0; index < 60; index += 1) {
      profile = applyChoice(profile, choice({ mealCode: `M${index}` }), CONFIG);
    }
    expect(profile.history).toHaveLength(50);
    expect(profile.history[0].mealCode).toBe('M59');
    expect(profile.history[49].mealCode).toBe('M10');
  });
});

describe('recordChoice / saveProfile / readProfile', () => {
  it('记录选择后持久化并可读回', async () => {
    const store = createProfileStore(file);
    await recordChoice(choice(), store, CONFIG);

    const profile = await readProfile(store);
    expect(profile.history).toHaveLength(1);
    expect(profile.history[0].source).toBe('explicit');
    expect(profile.preferences.categoryWeights.burger).toBeCloseTo(1);
    expect(profile.updatedAt).toBeTruthy();
  });

  it('saveProfile 刷新 updatedAt', async () => {
    const store = createProfileStore(file);
    const saved = await saveProfile(createDefaultProfile(), store);
    expect(saved.updatedAt).toBeTruthy();
    expect((await readProfile(store)).updatedAt).toBe(saved.updatedAt);
  });

  it('并发记录不丢更新（单写者串行化）', async () => {
    const store = createProfileStore(file);
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        recordChoice(choice({ mealCode: `M${index}` }), store, CONFIG),
      ),
    );
    const profile = await readProfile(store);
    expect(profile.history).toHaveLength(20);
  });
});

describe('buildStartingProfile', () => {
  it('以推荐结果作为起始画像（弱权重 recommended）', async () => {
    const store = createProfileStore(file);
    await buildStartingProfile(candidate(), store, '', CONFIG);
    const first = await readProfile(store);
    expect(first.history[0].source).toBe('recommended');
    expect(first.preferences.categoryWeights.burger).toBeCloseTo(1);

    await buildStartingProfile(candidate({ code: 'M2', name: '薯条', category: 'fries' }), store, '', CONFIG);
    const second = await readProfile(store);
    // 弱权重：0.85 / 0.15（若为强权重则为 0.6 / 0.4）
    expect(second.preferences.categoryWeights.burger).toBeCloseTo(0.85);
    expect(second.preferences.categoryWeights.fries).toBeCloseTo(0.15);
  });
});

describe('getProfileSummary', () => {
  it('空画像给出默认提示', async () => {
    const summary = await getProfileSummary(createProfileStore(file));
    expect(summary.totalChoices).toBe(0);
    expect(summary.text).toBe('暂无偏好记录，推荐将使用默认设定。');
  });

  it('输出脱敏可读摘要（门店编码掩码）', async () => {
    const store = createProfileStore(file);
    await recordChoice(choice({ storeCode: 'S1001', category: 'burger' }), store, CONFIG);

    const summary = await getProfileSummary(store);
    expect(summary.totalChoices).toBe(1);
    expect(summary.topCategories[0]).toEqual({ category: 'burger', weight: 1 });
    expect(summary.frequentStores).toEqual(['*1001']);
    expect(summary.text).toContain('偏好品类：burger(1.00)');
    expect(summary.text).not.toContain('S1001');
  });

  it('保留营养目标并在摘要中呈现', async () => {
    const store = createProfileStore(file);
    const base = await readProfile(store);
    base.preferences.nutritionGoal = { maxKcal: 600, minProtein: 20 };
    await saveProfile(base, store);

    await recordChoice(choice(), store, CONFIG);

    const summary = await getProfileSummary(store);
    expect(summary.nutritionGoal).toEqual({ maxKcal: 600, minProtein: 20 });
    expect(summary.text).toContain('热量上限 600kcal');
    expect(summary.text).toContain('蛋白质下限 20g');
  });

  it('v1.1.0：摘要展示位置/口味，且对位置脱敏（不暴露地址 ID）', async () => {
    const store = createProfileStore(file);
    const base = await readProfile(store);
    base.location = { city: '上海', channel: 'nearby', defaultAddressId: 'A001', defaultStoreCode: 'S1001' };
    base.preferences.taste = { tags: ['辣', '鸡'] };
    await saveProfile(base, store);

    const summary = await getProfileSummary(store);
    expect(summary.taste?.tags).toEqual(['辣', '鸡']);
    expect(summary.location?.city).toBe('上海');
    expect(summary.location?.defaultStoreCode).toBe('*1001');
    expect(summary.location?.defaultAddressId).toBeUndefined();
    expect(summary.text).toContain('位置/取餐：上海·到店');
    expect(summary.text).toContain('口味偏好：辣、鸡');
    expect(summary.text).not.toContain('A001');
  });
});

describe('默认 store 路径', () => {
  it('使用 MCD_PROFILE_PATH 指定的文件', async () => {
    vi.stubEnv('MCD_PROFILE_PATH', file);
    const saved = await saveProfile(createDefaultProfile());
    expect(saved.updatedAt).toBeTruthy();
    expect((await readProfile()).history).toEqual([]);
  });
});

describe('applyProfilePatch（响应 v1.2.0 纠正/清除）', () => {
  function withFields(): ReturnType<typeof createDefaultProfile> {
    const profile = createDefaultProfile();
    profile.location = { city: '上海', channel: 'nearby' };
    profile.preferences.taste = { tags: ['辣'] };
    profile.preferences.dietary = { avoid: ['牛肉'], allergies: ['乳制品'] };
    profile.preferences.priceBand = { min: 20, max: 40 };
    profile.preferences.nutritionGoal = { maxKcal: 700 };
    return profile;
  }

  it('clear 逐维度清除，其余保留', () => {
    const next = applyProfilePatch(withFields(), { clear: ['taste', 'budget'] });
    expect(next.preferences.taste).toBeUndefined();
    expect(next.preferences.priceBand).toEqual({ min: 0, max: 0 });
    expect(next.preferences.dietary).toBeDefined();
    expect(next.location?.city).toBe('上海');
  });

  it('clear location/nutrition/dietary', () => {
    const next = applyProfilePatch(withFields(), { clear: ['location', 'nutrition', 'dietary'] });
    expect(next.location).toBeUndefined();
    expect(next.preferences.nutritionGoal).toBeUndefined();
    expect(next.preferences.dietary).toBeUndefined();
  });

  it('dietary 合并去重；两列表皆空则不下发', () => {
    const merged = applyProfilePatch(withFields(), {
      dietary: { avoid: ['牛肉', '猪肉'], allergies: ['乳制品', '蛋'] },
    });
    expect(merged.preferences.dietary?.avoid).toEqual(['牛肉', '猪肉']);
    expect(merged.preferences.dietary?.allergies).toEqual(['乳制品', '蛋']);

    const cleared = applyProfilePatch(withFields(), { dietary: { removeAvoid: ['牛肉'], removeAllergies: ['乳制品'] } });
    expect(cleared.preferences.dietary).toBeUndefined();
  });
});

describe('resetProfile', () => {
  it('重置为默认画像（清空位置/口味/忌口）', async () => {
    const store = createProfileStore(file);
    const base = await readProfile(store);
    base.location = { city: '上海' };
    base.preferences.taste = { tags: ['辣'] };
    base.preferences.dietary = { avoid: ['牛肉'], allergies: [] };
    await saveProfile(base, store);

    const reset = await resetProfile(store);
    expect(reset.location).toBeUndefined();
    expect(reset.preferences.taste).toBeUndefined();
    expect(reset.preferences.dietary).toBeUndefined();
    expect(reset.history).toEqual([]);
  });
});
