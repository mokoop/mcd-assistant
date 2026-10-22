import { describe, expect, it } from 'vitest';

import { ErrorCode } from '@/core/errors';
import { AppError } from '@/core/errors';
import { handleRequest, validateRequest } from '@/index';
import type { SkillDeps } from '@/index';
import type { ProfileSummary } from '@/profile/index';
import type { RecommendOptions, RecommendResult } from '@/recommender/index';
import type { ReminderConfigInput, ReminderEvaluation } from '@/reminder/index';
import type { ChoiceRecord, MealCandidate, Recommendation, ReminderConfig, UserProfile } from '@/types/index';

function testProfile(): UserProfile {
  return {
    version: 1,
    preferences: { categoryWeights: { 汉堡: 0.8 }, priceBand: { min: 20, max: 40 } },
    frequent: { storeCodes: [], timeSlots: [] },
    history: [],
    updatedAt: '2026-10-10T00:00:00.000Z',
  };
}

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

function makeResult(overrides: Partial<Recommendation> = {}): RecommendResult {
  const alternative: MealCandidate = { code: 'M002', name: '双层吉士堡套餐', price: 33, effectivePrice: 25, score: 0.6, breakdown: {} };
  const recommendation: Recommendation = {
    primary: primary(),
    alternatives: [alternative],
    reasons: ['符合你偏好的「汉堡」口味', '券后省 ¥8.00'],
    generatedAt: '2026-10-10T00:00:00.000Z',
    degraded: false,
    ...overrides,
  };
  return {
    recommendation,
    channel: 'delivery',
    store: { storeCode: 'S1', beCode: '2' },
    nutritionRelaxed: false,
    dietaryRelaxed: false,
    coldStart: false,
    notices: [],
  };
}

function makeEvaluation(
  status: ReminderEvaluation['decision']['status'],
  overrides: Partial<ReminderEvaluation> = {},
): ReminderEvaluation {
  const reason =
    status === 'trigger' ? 'due' : status === 'not-configured' ? 'not-configured' : 'not-due';
  return {
    state: {},
    decision: {
      status,
      reason,
      timezone: 'Asia/Shanghai',
      timezoneMismatch: false,
      date: '2026-10-10',
      dayOfWeek: 6,
      nowTime: '12:00',
    },
    message: `MSG:${status}`,
    schedule: { available: false, mode: 'dialog-triggered', description: 'SCHED' },
    degraded: false,
    ...overrides,
  };
}

function makeSummary(): ProfileSummary {
  return {
    updatedAt: '2026-10-10T00:00:00.000Z',
    totalChoices: 3,
    topCategories: [{ category: '汉堡', weight: 0.8 }],
    priceBand: { min: 20, max: 40 },
    frequentStores: [],
    frequentTimeSlots: [],
    text: 'SUMMARY',
  };
}

function createFakeDeps(overrides: Partial<SkillDeps> = {}): { deps: SkillDeps; calls: Record<string, unknown[]> } {
  const calls: Record<string, unknown[]> = {
    recommend: [],
    recordChoice: [],
    buildStartingProfile: [],
    setReminder: [],
    autoBindCoupons: [],
  };
  const deps: SkillDeps = {
    evaluateReminder: async () => makeEvaluation('trigger'),
    recommend: async (options: RecommendOptions) => {
      calls.recommend.push(options);
      return makeResult();
    },
    readProfile: async () => testProfile(),
    recordChoice: async (record: ChoiceRecord) => {
      calls.recordChoice.push(record);
      return testProfile();
    },
    buildStartingProfile: async (candidate: MealCandidate, storeCode?: string) => {
      calls.buildStartingProfile.push({ code: candidate.code, storeCode });
      return testProfile();
    },
    getProfileSummary: async () => makeSummary(),
    buildOnboardingQuestions: () => ({ coldStart: false, questions: [] }),
    configureProfile: async () => testProfile(),
    recordNegativeSignal: async () => testProfile(),
    resetProfile: async () => testProfile(),
    autoBindCoupons: async () => {
      calls.autoBindCoupons.push(true);
      return { data: [{ couponId: 'C1', couponCode: 'X' }], degraded: false };
    },
    availableCoupons: async () => ({ data: [{ couponId: 'C1', name: '立减8', discount: '8' }], degraded: false }),
    setReminder: async (input: ReminderConfigInput): Promise<ReminderConfig> => {
      calls.setReminder.push(input);
      return { mealType: input.mealType, time: input.time, days: input.days ?? [], enabled: true };
    },
    buildHostScheduleSuggestion: () => ({
      available: true,
      mode: 'host-cron',
      cronExpression: '0 12 * * *',
      triggerTime: '12:00',
      description: 'CRON',
    }),
    ...overrides,
  };
  return { deps, calls };
}

describe('handleRequest 路由', () => {
  it('对话式 + 到点触发 → 提醒文案 + 推荐', async () => {
    const { deps } = createFakeDeps();
    const response = await handleRequest({}, deps);
    expect(response.action).toBe('chat');
    expect(response.text).toContain('MSG:trigger');
    expect(response.text).toContain('巨无霸套餐');
    expect(response.recommendation?.primary.code).toBe('M001');
    expect(response.reminder?.decision.status).toBe('trigger');
  });

  it('对话式 + 未设定提醒 → 引导文案（不推荐、不报错）', async () => {
    const { deps } = createFakeDeps({ evaluateReminder: async () => makeEvaluation('not-configured') });
    const response = await handleRequest({}, deps);
    expect(response.text).toContain('MSG:not-configured');
    expect(response.recommendation).toBeUndefined();
  });

  it('对话式 + 跳过 → 仅交付提示', async () => {
    const { deps } = createFakeDeps({ evaluateReminder: async () => makeEvaluation('skip') });
    const response = await handleRequest({}, deps);
    expect(response.text).toContain('MSG:skip');
    expect(response.recommendation).toBeUndefined();
  });

  it('对话式触发：时区透传给推荐', async () => {
    const { deps, calls } = createFakeDeps();
    await handleRequest({}, deps);
    const options = calls.recommend[0] as RecommendOptions;
    expect(options.timezone).toBe('Asia/Shanghai');
  });

  it('recommend：budget/nutritionGoal 覆盖画像，并返回脱敏摘要', async () => {
    const { deps, calls } = createFakeDeps();
    const response = await handleRequest(
      { action: 'recommend', budget: { min: 10, max: 20 }, nutritionGoal: { maxKcal: 600 } },
      deps,
    );
    const options = calls.recommend[0] as RecommendOptions;
    expect(options.profile?.preferences.priceBand).toEqual({ min: 10, max: 20 });
    expect(options.profile?.preferences.nutritionGoal).toEqual({ maxKcal: 600 });
    expect(response.profileSummary).toBeDefined();
    expect(response.text).toContain('SUMMARY');
    expect(response.text).toContain('券后价');
  });

  it('set-reminder：写入配置并输出宿主定时建议', async () => {
    const { deps, calls } = createFakeDeps();
    const response = await handleRequest({ action: 'set-reminder', mealType: 'lunch', time: '12:00', days: [1, 2] }, deps);
    expect(calls.setReminder).toHaveLength(1);
    expect(response.text).toContain('CRON');
    expect(response.schedule?.available).toBe(true);
    // 文案须反映真实生效日，不得硬编码「每天」
    expect(response.text).toContain('周一');
    expect(response.text).not.toContain('每天');
  });

  it('set-reminder：未指定 days → 文案为「每天」', async () => {
    const { deps } = createFakeDeps();
    const response = await handleRequest({ action: 'set-reminder', mealType: 'dinner', time: '18:30' }, deps);
    expect(response.text).toContain('每天');
  });

  it('set-reminder：缺参时提示补全，不写入', async () => {
    const { deps, calls } = createFakeDeps();
    const response = await handleRequest({ action: 'set-reminder' }, deps);
    expect(calls.setReminder).toHaveLength(0);
    expect(response.text).toContain('餐次');
  });

  it('show-profile：输出脱敏画像', async () => {
    const { deps } = createFakeDeps();
    const response = await handleRequest({ action: 'show-profile' }, deps);
    expect(response.text).toContain('SUMMARY');
    expect(response.profileSummary?.totalChoices).toBe(3);
  });

  it('bind-coupons：未确认时列出券并要求确认，不调用写操作', async () => {
    const { deps, calls } = createFakeDeps();
    const response = await handleRequest({ action: 'bind-coupons' }, deps);
    expect(calls.autoBindCoupons).toHaveLength(0);
    expect(response.text).toContain('确认');
  });

  it('bind-coupons：确认后调用写操作并返回结果', async () => {
    const { deps, calls } = createFakeDeps();
    const response = await handleRequest({ action: 'bind-coupons', confirmed: true }, deps);
    expect(calls.autoBindCoupons).toHaveLength(1);
    expect(response.bindResult).toHaveLength(1);
    expect(response.text).toContain('已为你领取');
  });

  it('明确选择 → 记录为 explicit', async () => {
    const { deps, calls } = createFakeDeps();
    await handleRequest({ action: 'recommend', selectedMealCode: 'M001' }, deps);
    const record = calls.recordChoice[0] as ChoiceRecord;
    expect(record.mealCode).toBe('M001');
    expect(record.source).toBe('explicit');
    expect(record.storeCode).toBe('S1');
  });

  it('采纳默认 → 写入起始画像（弱权重）', async () => {
    const { deps, calls } = createFakeDeps();
    await handleRequest({ action: 'recommend', accepted: true }, deps);
    expect(calls.buildStartingProfile[0]).toEqual({ code: 'M001', storeCode: 'S1' });
    expect(calls.recordChoice).toHaveLength(0);
  });

  it('依赖异常 → 友好提示且不抛出；门店空结果给出切换建议', async () => {
    const tokenDeps = createFakeDeps({
      recommend: async () => {
        throw new AppError({ code: ErrorCode.TOKEN_MISSING, message: 'no token' });
      },
    });
    const response = await handleRequest({ action: 'recommend' }, tokenDeps.deps);
    expect(response.text).toContain('MCD_MCP_TOKEN');
    expect(response.degraded).toBe(false);

    const emptyDeps = createFakeDeps({
      recommend: async () => {
        throw new AppError({ code: ErrorCode.EMPTY_RESULT, message: '未找到可用门店' });
      },
    });
    const emptyResponse = await handleRequest({ action: 'recommend' }, emptyDeps.deps);
    expect(emptyResponse.text).toContain('门店');
  });

  it('degraded 传播：提醒降级 → 响应 degraded', async () => {
    const { deps } = createFakeDeps({ evaluateReminder: async () => makeEvaluation('skip', { degraded: true }) });
    const response = await handleRequest({}, deps);
    expect(response.degraded).toBe(true);
  });

  it('BUG-2：负数预算被校验拒绝并友好提示', async () => {
    const { deps, calls } = createFakeDeps();
    const response = await handleRequest({ action: 'recommend', budget: { min: -1, max: 20 } }, deps);
    expect(response.text).toContain('预算');
    expect(response.recommendation).toBeUndefined();
    expect(calls.recommend).toHaveLength(0);
  });

  it('BUG-2：预算 max<min 被拒绝', async () => {
    const { deps } = createFakeDeps();
    const response = await handleRequest({ action: 'recommend', budget: { min: 30, max: 10 } }, deps);
    expect(response.text).toContain('预算');
  });

  it('BUG-2：负数营养目标被拒绝', async () => {
    const { deps } = createFakeDeps();
    const response = await handleRequest({ action: 'recommend', nutritionGoal: { maxKcal: -100 } }, deps);
    expect(response.text).toContain('营养目标');
  });

  it('BUG-3：超长 keyword 被校验拒绝且不发起推荐', async () => {
    const { deps, calls } = createFakeDeps();
    const response = await handleRequest({ action: 'recommend', keyword: 'x'.repeat(200) }, deps);
    expect(response.text).toContain('关键词');
    expect(calls.recommend).toHaveLength(0);
  });

  it('合法预算/营养目标仍正常推荐', async () => {
    const { deps, calls } = createFakeDeps();
    const response = await handleRequest(
      { action: 'recommend', budget: { min: 0, max: 50 }, nutritionGoal: { maxKcal: 800, minProtein: 10 } },
      deps,
    );
    expect(calls.recommend).toHaveLength(1);
    expect(response.recommendation).toBeDefined();
  });

  it('v1.1.0：非法 scene / channel / tasteTags 被校验拒绝', () => {
    expect(() => validateRequest({ scene: 'banana' as never })).toThrow(/场景/);
    expect(() => validateRequest({ channel: 'drone' as never })).toThrow(/取餐方式/);
    expect(() => validateRequest({ tasteTags: ['苦'] })).toThrow(/口味标签/);
    expect(() => validateRequest({ action: 'recommend', scene: 'save', channel: 'nearby', tasteTags: ['辣'] })).not.toThrow();
  });

  it('v1.2.0：非法 avoid/clearFields 与动作不一致被拒绝', () => {
    expect(() => validateRequest({ action: 'configure', avoid: ['花生'] })).toThrow(/忌口|过敏/);
    expect(() => validateRequest({ action: 'configure', clearFields: ['taste2' as never] })).toThrow(/clear/);
    // clearFields 仅允许 configure
    expect(() => validateRequest({ action: 'recommend', clearFields: ['taste'] })).toThrow(/configure/);
    expect(() => validateRequest({ action: 'configure', avoid: ['牛肉'], clearFields: ['taste'] })).not.toThrow();
  });

  it('onboarding 动作 → 返回待问清单', async () => {
    const { deps } = createFakeDeps({
      buildOnboardingQuestions: () => ({
        coldStart: true,
        questions: [{ key: 'budget', label: '一餐预算？', why: '控预算', kind: 'range', required: true }],
      }),
    });
    const response = await handleRequest({ action: 'onboarding' }, deps);
    expect(response.action).toBe('onboarding');
    expect(response.onboarding?.coldStart).toBe(true);
    expect(response.text).toContain('一餐预算');
  });
});
