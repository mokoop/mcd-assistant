import { describe, expect, it } from 'vitest';

import { CLI_ACTIONS, parseArgs, runCli } from '@/cli';
import type { CliIo } from '@/cli';
import type { SkillDeps } from '@/index';
import type { RecommendResult } from '@/recommender/index';
import type { Recommendation } from '@/types/index';

function capturedIo(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (text) => out.push(text), err: (text) => err.push(text) }, out, err };
}

function recommendation(): Recommendation {
  return {
    primary: { code: 'M1', name: '套餐A', price: 30, effectivePrice: 20, discount: 10, category: '汉堡', score: 0.9, breakdown: { category: 0.5 } },
    alternatives: [],
    reasons: ['符合你偏好的「汉堡」口味', '券后省 ¥10.00'],
    generatedAt: '2026-10-10T00:00:00.000Z',
    degraded: true,
  };
}

function fakeDeps(): SkillDeps {
  const recommendResult: RecommendResult = {
    recommendation: recommendation(),
    channel: 'nearby',
    store: { storeCode: 'S1' },
    nutritionRelaxed: false,
    dietaryRelaxed: false,
    coldStart: false,
    notices: ['当前为离线演示数据'],
  };
  const deps = {
    readProfile: async () => ({ version: 2, preferences: {}, frequent: {}, history: [], updatedAt: '' }),
    recommend: async () => recommendResult,
    getProfileSummary: async () => ({
      updatedAt: '',
      totalChoices: 0,
      topCategories: [],
      priceBand: { min: 0, max: 0 },
      frequentStores: [],
      frequentTimeSlots: [],
      text: '暂无偏好记录。',
    }),
    buildOnboardingQuestions: () => ({
      coldStart: true,
      questions: [
        { key: 'channel', label: '怎么取餐？', why: '定位门店', kind: 'single' as const, required: true, options: ['到店'] },
      ],
    }),
    configureProfile: async () => ({ version: 2, preferences: {}, frequent: {}, history: [], updatedAt: '' }),
    recordNegativeSignal: async () => ({ version: 2, preferences: {}, frequent: {}, history: [], updatedAt: '' }),
    resetProfile: async () => ({ version: 2, preferences: {}, frequent: {}, history: [], updatedAt: '' }),
  };
  return deps as unknown as SkillDeps;
}

describe('parseArgs', () => {
  it('无参数 → chat，空请求', () => {
    const parsed = parseArgs([]);
    expect(parsed.action).toBe('chat');
    expect(parsed.request).toEqual({});
    expect(parsed.json).toBe(false);
    expect(parsed.help).toBe(false);
  });

  it('未知子命令 → 抛错', () => {
    expect(() => parseArgs(['brunch'])).toThrow(/未知子命令/);
  });

  it('meal-type 仅接受 lunch/dinner', () => {
    expect(parseArgs(['recommend', '--meal-type', 'lunch']).request.mealType).toBe('lunch');
    expect(() => parseArgs(['recommend', '--meal-type', 'brunch'])).toThrow(/lunch 或 dinner/);
  });

  it('budget 与 nutritionGoal 组装', () => {
    const parsed = parseArgs(['recommend', '--budget-min', '20', '--budget-max', '40', '--max-kcal', '700']);
    expect(parsed.request.budget).toEqual({ min: 20, max: 40 });
    expect(parsed.request.nutritionGoal).toEqual({ maxKcal: 700 });
  });

  it('days 解析与校验', () => {
    expect(parseArgs(['set-reminder', '--days', '1,2,3']).request.days).toEqual([1, 2, 3]);
    expect(() => parseArgs(['set-reminder', '--days', '9'])).toThrow(/0-6/);
  });

  it('quietHours 需成对', () => {
    expect(() => parseArgs(['set-reminder', '--quiet-start', '22:00'])).toThrow(/同时提供/);
    expect(parseArgs(['set-reminder', '--quiet-start', '22:00', '--quiet-end', '08:00']).request.quietHours).toEqual({ start: '22:00', end: '08:00' });
  });

  it('布尔开关与 --json', () => {
    const parsed = parseArgs(['bind-coupons', '--confirmed', '--json']);
    expect(parsed.request.confirmed).toBe(true);
    expect(parsed.json).toBe(true);
  });

  it('缺取值与未知参数 → 抛错', () => {
    expect(() => parseArgs(['--meal-type'])).toThrow(/缺少取值/);
    expect(() => parseArgs(['--nope'])).toThrow(/未知参数/);
  });

  it('导出全部子命令', () => {
    expect([...CLI_ACTIONS]).toEqual([
      'recommend',
      'onboarding',
      'configure',
      'reset-profile',
      'set-reminder',
      'show-profile',
      'bind-coupons',
      'chat',
    ]);
  });

  it('v1.1.0 参数：--channel/--taste/--scene/--exclude/--rejected/--dislike-taste', () => {
    const parsed = parseArgs([
      'recommend',
      '--channel', 'nearby',
      '--taste', '辣,鸡',
      '--scene', 'save',
      '--exclude', 'M1,M2',
      '--rejected', 'M3',
      '--dislike-taste', '辣',
    ]);
    expect(parsed.request.channel).toBe('nearby');
    expect(parsed.request.tasteTags).toEqual(['辣', '鸡']);
    expect(parsed.request.scene).toBe('save');
    expect(parsed.request.excludeCodes).toEqual(['M1', 'M2']);
    expect(parsed.request.rejectedMealCode).toBe('M3');
    expect(parsed.request.dislikeTaste).toBe('辣');
  });

  it('v1.2.0 参数：--allergy/--avoid/--clear', () => {
    const parsed = parseArgs(['configure', '--allergy', '乳制品', '--avoid', '牛肉,猪肉', '--clear', 'taste,budget']);
    expect(parsed.request.allergies).toEqual(['乳制品']);
    expect(parsed.request.avoid).toEqual(['牛肉', '猪肉']);
    expect(parsed.request.clearFields).toEqual(['taste', 'budget']);
  });

  it('v1.1.0：非法 --scene / --channel 抛错', () => {
    expect(() => parseArgs(['recommend', '--scene', 'party'])).toThrow(/--scene/);
    expect(() => parseArgs(['recommend', '--channel', 'drone'])).toThrow(/--channel/);
  });
});

describe('runCli', () => {
  it('recommend 输出推荐文本，退出码 0', async () => {
    const { io, out } = capturedIo();
    const code = await runCli(['recommend', '--meal-type', 'lunch'], fakeDeps(), io);
    expect(code).toBe(0);
    expect(out.join('')).toContain('套餐A');
  });

  it('show-profile 输出画像文本', async () => {
    const { io, out } = capturedIo();
    const code = await runCli(['show-profile'], fakeDeps(), io);
    expect(code).toBe(0);
    expect(out.join('')).toContain('暂无偏好记录');
  });

  it('--json 输出可解析的结构化结果', async () => {
    const { io, out } = capturedIo();
    await runCli(['recommend', '--json'], fakeDeps(), io);
    const parsed = JSON.parse(out.join('')) as { action: string; recommendation?: unknown };
    expect(parsed.action).toBe('recommend');
    expect(parsed.recommendation).toBeDefined();
  });

  it('参数错误 → 退出码 2 且提示到 stderr', async () => {
    const { io, err } = capturedIo();
    const code = await runCli(['recommend', '--meal-type', 'brunch'], fakeDeps(), io);
    expect(code).toBe(2);
    expect(err.join('')).toContain('错误');
  });

  it('onboarding 输出待问清单', async () => {
    const { io, out } = capturedIo();
    const code = await runCli(['onboarding'], fakeDeps(), io);
    expect(code).toBe(0);
    expect(out.join('')).toContain('怎么取餐');
  });

  it('--help 打印用法，退出码 0', async () => {
    const { io, out } = capturedIo();
    const code = await runCli(['--help'], fakeDeps(), io);
    expect(code).toBe(0);
    expect(out.join('')).toContain('用法');
  });
});
