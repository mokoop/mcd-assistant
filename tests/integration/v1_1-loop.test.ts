/**
 * 集成测试 D：v1.1.0 冷启动引导与反馈闭环。
 *
 * 覆盖：
 * - 冷启动：空画像 → onboarding 待问清单 → configure 落盘 → recommend 标 coldStart 且有理由；
 * - 冷启动打分信号：门店热销 `frequent` → popularity、口味标签推断；
 * - 场景模式：scene=save 生效并在输出注明；
 * - 反馈闭环：exclude（换一换）/ rejected（记负重推）/ dislike-taste（口味纠偏）。
 */

import { describe, expect, it } from 'vitest';

import { handleRequest } from '@/index';
import { createDefaultProfile } from '@/profile/defaults';
import { buildCandidates } from '@/recommender/candidates';
import { recommend } from '@/recommender/index';

import { createFakeDeps, TEST_MEALS } from '../recommender/fake-deps.js';

import { createSkillDeps, makeRecommendation } from './helpers.js';

describe('集成 · 冷启动默认人格（recommender）', () => {
  it('空画像 → coldStart=true，且给出理由与冷启动提示', async () => {
    const { deps } = createFakeDeps({ readProfile: async () => createDefaultProfile() });
    const result = await recommend({ profile: createDefaultProfile() }, deps);
    expect(result.coldStart).toBe(true);
    expect(result.recommendation.coldStart).toBe(true);
    expect(result.recommendation.reasons.length).toBeGreaterThanOrEqual(2);
    expect(result.notices.join('')).toContain('起点');
  });

  it('门店热销 frequent → 候选 popularity 标注正确，口味标签已推断', async () => {
    const { deps } = createFakeDeps({
      queryMeals: async () => ({
        data: { meals: { ...TEST_MEALS }, frequent: ['M003'] },
        degraded: false,
      }),
    });
    const built = await buildCandidates(deps, { storeCode: 'S1', beCode: '2', orderType: 1, beType: 1 });
    const hot = built.candidates.find((c) => c.code === 'M003');
    const normal = built.candidates.find((c) => c.code === 'M001');
    expect(hot?.popularity).toBe(1);
    expect(normal?.popularity).toBe(0);
    expect(hot?.tasteTags).toContain('辣');
  });

  it('热销数据为空 → popularity 中性 0.5', async () => {
    const { deps } = createFakeDeps(); // 默认 queryMeals 不带 frequent
    const built = await buildCandidates(deps, { storeCode: 'S1', beCode: '2', orderType: 1, beType: 1 });
    expect(built.candidates.every((c) => c.popularity === 0.5)).toBe(true);
  });

  it('场景 save → 生效并在 notices 注明', async () => {
    const { deps } = createFakeDeps();
    const result = await recommend({ scene: 'save', now: new Date('2026-10-10T04:00:00.000Z') }, deps);
    expect(result.scene).toBe('save');
    expect(result.recommendation.scene).toBe('save');
    expect(result.notices.join('')).toContain('省钱优先');
  });

  it('excludeCodes（换一换）→ 结果不含被排除项', async () => {
    const { deps } = createFakeDeps();
    const first = await recommend({}, deps);
    const excluded = first.recommendation.primary.code;
    const second = await recommend({ excludeCodes: [excluded] }, deps);
    expect(second.recommendation.primary.code).not.toBe(excluded);
  });

  it('画像 location 回退：recommend 使用画像中的渠道/城市（位置闭环）', async () => {
    let captured: { city?: string } | undefined;
    const profile = { ...createDefaultProfile(), location: { channel: 'nearby' as const, city: '上海' } };
    const { deps } = createFakeDeps({
      queryNearbyStores: async (query) => {
        captured = query;
        return { data: [{ storeCode: 'S1', beCode: '2' }], degraded: false };
      },
    });
    const result = await recommend({ profile }, deps);
    expect(captured?.city).toBe('上海');
    expect(result.channel).toBe('nearby');
  });
});

describe('集成 · 编排层反馈闭环（handleRequest）', () => {
  it('onboarding 动作 → 返回待问清单与文案', async () => {
    const { deps } = createSkillDeps({
      buildOnboardingQuestions: () => ({
        coldStart: true,
        questions: [
          { key: 'budget', label: '一餐预算？', why: '控预算', kind: 'range', required: true },
        ],
      }),
    });
    const res = await handleRequest({ action: 'onboarding' }, deps);
    expect(res.action).toBe('onboarding');
    expect(res.onboarding?.coldStart).toBe(true);
    expect(res.text).toContain('一餐预算');
  });

  it('configure 动作 → 调用 configureProfile 落盘并返回摘要', async () => {
    const captured: unknown[] = [];
    const { deps } = createSkillDeps({
      configureProfile: async (patch) => {
        captured.push(patch);
        return createDefaultProfile();
      },
    });
    const res = await handleRequest(
      { action: 'configure', city: '上海', channel: 'nearby', budget: { min: 20, max: 40 }, tasteTags: ['辣'] },
      deps,
    );
    expect(res.action).toBe('configure');
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      location: { city: '上海', channel: 'nearby' },
      priceBand: { min: 20, max: 40 },
      taste: { tags: ['辣'] },
    });
  });

  it('rejected → 记负反馈并对该餐品重推（排除）', async () => {
    const optionsSeen: Array<{ excludeCodes?: string[] }> = [];
    const neg: string[] = [];
    const { deps } = createSkillDeps({
      recommend: async (options) => {
        optionsSeen.push({ ...(options.excludeCodes ? { excludeCodes: options.excludeCodes } : {}) });
        return {
          recommendation: makeRecommendation(),
          channel: 'delivery',
          store: { storeCode: 'S1', beCode: '2' },
          nutritionRelaxed: false,
          dietaryRelaxed: false,
          coldStart: false,
          notices: [],
        };
      },
      recordNegativeSignal: async (category) => {
        neg.push(category);
        return createDefaultProfile();
      },
    });
    // makeRecommendation 主推 code=M001、category=汉堡
    const res = await handleRequest({ action: 'recommend', rejectedMealCode: 'M001' }, deps);
    expect(res.recommendation).toBeDefined();
    expect(neg).toContain('汉堡');
    expect(optionsSeen).toHaveLength(2);
    expect(optionsSeen[1]?.excludeCodes).toContain('M001');
  });

  it('dislike-taste → 移除标签并抑制匹配品类', async () => {
    const patches: unknown[] = [];
    const neg: string[] = [];
    const { deps } = createSkillDeps({
      configureProfile: async (patch) => {
        patches.push(patch);
        return createDefaultProfile();
      },
      recordNegativeSignal: async (category) => {
        neg.push(category);
        return createDefaultProfile();
      },
    });
    await handleRequest({ action: 'recommend', dislikeTaste: '清淡' }, deps);
    expect(patches[0]).toMatchObject({ taste: { removeTags: ['清淡'] } });
    // 清淡 → 轻食/沙拉/素食 三个品类被抑制
    expect(neg).toEqual(expect.arrayContaining(['轻食', '沙拉', '素食']));
  });
});
