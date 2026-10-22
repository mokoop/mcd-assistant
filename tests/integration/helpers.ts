/**
 * 集成 / 确认测试公共夹具（QA）。
 *
 * 约束：确定性、无外网依赖；临时文件一律置于 `os.tmpdir()` 并在用例后清理。
 * 本文件不匹配 `*.test.ts`，仅被同目录测试复用。
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { SkillDeps } from '@/index';
import type { ProfileSummary } from '@/profile/index';
import type { ReminderEvaluation } from '@/reminder/index';
import type {
  ChoiceRecord,
  MealCandidate,
  Recommendation,
  ReminderConfig,
  UserProfile,
} from '@/types/index';

/** 隔离的临时环境（目录 + 数据文件路径），`cleanup()` 删除整个临时目录 */
export interface TempEnv {
  dir: string;
  profilePath: string;
  reminderConfigPath: string;
  reminderStatePath: string;
  cleanup(): Promise<void>;
}

/** 创建基于 `os.tmpdir()` 的临时环境 */
export async function createTempEnv(prefix: string): Promise<TempEnv> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  return {
    dir,
    profilePath: join(dir, 'profile.json'),
    reminderConfigPath: join(dir, 'reminder-config.json'),
    reminderStatePath: join(dir, 'reminder-state.json'),
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

/** 测试用例样本候选 */
export function makeCandidate(overrides: Partial<MealCandidate> = {}): MealCandidate {
  return {
    code: 'M001',
    name: '巨无霸套餐',
    category: '汉堡',
    price: 39,
    effectivePrice: 31,
    discount: 8,
    nutrition: { energyKcal: 590, protein: 27 },
    score: 0.8,
    breakdown: {},
    ...overrides,
  };
}

/** 测试用例样本推荐结果 */
export function makeRecommendation(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    primary: makeCandidate(),
    alternatives: [makeCandidate({ code: 'M002', name: '双层吉士堡套餐', price: 33, effectivePrice: 33 })],
    reasons: ['符合你偏好的「汉堡」口味', '券后省 ¥8.00'],
    generatedAt: '2026-10-10T00:00:00.000Z',
    degraded: false,
    ...overrides,
  };
}

/** 测试用例样本画像 */
export function makeProfile(): UserProfile {
  return {
    version: 1,
    preferences: { categoryWeights: { 汉堡: 0.8 }, priceBand: { min: 20, max: 40 } },
    frequent: { storeCodes: [], timeSlots: [] },
    history: [],
    updatedAt: '2026-10-10T00:00:00.000Z',
  };
}

/** 测试用例样本脱敏摘要 */
export function makeSummary(): ProfileSummary {
  return {
    updatedAt: '2026-10-10T00:00:00.000Z',
    totalChoices: 0,
    topCategories: [],
    priceBand: { min: 0, max: 0 },
    frequentStores: [],
    frequentTimeSlots: [],
    text: 'SUMMARY',
  };
}

/** 测试用例样本提醒评估结果 */
export function makeReminderEvaluation(
  status: ReminderEvaluation['decision']['status'],
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
  };
}

/** 依赖调用计数（供 index 编排断言） */
export interface SkillSpies {
  recommend: number;
  autoBindCoupons: number;
  setReminder: number;
  recordChoice: number;
  buildStartingProfile: number;
  configureProfile: number;
  recordNegativeSignal: number;
}

/**
 * 构建可注入的 `SkillDeps`（零网络 / 零 IO），记录各依赖调用次数以断言编排行为。
 */
export function createSkillDeps(overrides: Partial<SkillDeps> = {}): {
  deps: SkillDeps;
  spies: SkillSpies;
} {
  const spies: SkillSpies = {
    recommend: 0,
    autoBindCoupons: 0,
    setReminder: 0,
    recordChoice: 0,
    buildStartingProfile: 0,
    configureProfile: 0,
    recordNegativeSignal: 0,
  };
  const deps: SkillDeps = {
    evaluateReminder: async () => makeReminderEvaluation('trigger'),
    recommend: async () => {
      spies.recommend += 1;
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
    readProfile: async () => makeProfile(),
    recordChoice: async (record: ChoiceRecord) => {
      spies.recordChoice += 1;
      return { ...makeProfile(), history: [record] };
    },
    buildStartingProfile: async (candidate: MealCandidate, storeCode?: string) => {
      spies.buildStartingProfile += 1;
      void candidate;
      void storeCode;
      return makeProfile();
    },
    getProfileSummary: async () => makeSummary(),
    buildOnboardingQuestions: () => ({ coldStart: false, questions: [] }),
    configureProfile: async () => {
      spies.configureProfile += 1;
      return makeProfile();
    },
    recordNegativeSignal: async () => {
      spies.recordNegativeSignal += 1;
      return makeProfile();
    },
    resetProfile: async () => makeProfile(),
    autoBindCoupons: async () => {
      spies.autoBindCoupons += 1;
      return { data: [{ couponId: 'C1', couponCode: 'X' }], degraded: false };
    },
    availableCoupons: async () => ({
      data: [{ couponId: 'C1', name: '立减8', discount: '8' }],
      degraded: false,
    }),
    setReminder: async (input): Promise<ReminderConfig> => {
      spies.setReminder += 1;
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
  return { deps, spies };
}
