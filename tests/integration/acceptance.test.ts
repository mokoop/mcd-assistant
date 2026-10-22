/**
 * 集成 / 确认测试 C：对照需求分析 §6 验收标准逐条验证（AC 6.1–6.6）。
 *
 * 说明：
 * - 提醒类（6.1）通过 `evaluateReminder` 注入确定性的时间源与隔离存储验证，避免依赖真实时钟；
 * - 推荐类（6.2）在 `recommender` 出口注入假依赖（零网络），验证过滤/打分/渠道/营养/多样性；
 * - 画像类（6.3）在临时目录验证 EMA 更新、起始画像、损坏回退与脱敏摘要；
 * - 离线（6.4）与领券（6.5）覆盖降级标记与写操作确认边界；
 * - 非法输入（6.6）三例：6.6-1 非法时间；6.6-2 负数营养目标/预算；6.6-3 超长 keyword。
 *   BUG-2 / BUG-3 已由开发修复，本文件按**实际修复行为**断言（拒绝并给出校验提示、不进入推荐、不发起 MCP 调用）。
 */

import { readFile, rm, writeFile } from 'node:fs/promises';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ErrorCode } from '@/core/errors';
import { handleRequest } from '@/index';
import { createMcpClient } from '@/mcp-client/tools';
import type { ToolTransport } from '@/mcp-client/types';
import {
  buildStartingProfile,
  createProfileStore,
  getProfileSummary,
  readProfile,
  recordChoice,
} from '@/profile/index';
import { filterCandidates } from '@/recommender/filter';
import { recommend } from '@/recommender/index';
import { noveltyFit } from '@/recommender/score';
import { resolveChannel } from '@/recommender/store-strategy';
import {
  createReminderConfigStore,
  createReminderStateStore,
  evaluateReminder,
  setReminder,
} from '@/reminder/index';
import type { NowTimeInfo } from '@/types/index';

import { createFakeDeps, testProfile } from '../recommender/fake-deps.js';

import { createSkillDeps, createTempEnv, makeCandidate, type TempEnv } from './helpers.js';

const ENV_KEYS = ['MCD_PROFILE_PATH', 'MCD_REMINDER_CONFIG_PATH', 'MCD_REMINDER_STATE_PATH'] as const;

let env: TempEnv;
let saved: Record<string, string | undefined> = {};

beforeAll(async () => {
  env = await createTempEnv('mcd-qa-accept-');
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env.MCD_PROFILE_PATH = env.profilePath;
  process.env.MCD_REMINDER_CONFIG_PATH = env.reminderConfigPath;
  process.env.MCD_REMINDER_STATE_PATH = env.reminderStatePath;
});

afterAll(async () => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = saved[key];
    }
  }
  await rm(env.dir, { recursive: true, force: true });
});

/** 构造携带显式偏移的 `now-time-info`（确定性，避免依赖真实时钟） */
function nowAt(datetime: string, overrides: Partial<NowTimeInfo> = {}): NowTimeInfo {
  return {
    datetime,
    date: datetime.slice(0, 10),
    dayOfWeek: 6,
    timezone: 'Asia/Shanghai',
    offset: '+08:00',
    ...overrides,
  };
}

/** 隔离的提醒配置 / 状态存储（唯一路径） */
function reminderStores(suffix: string) {
  return {
    configStore: createReminderConfigStore(`${env.dir}/rc-${suffix}.json`),
    stateStore: createReminderStateStore(`${env.dir}/rs-${suffix}.json`),
  };
}

describe('AC 6.1 就餐提醒', () => {
  it('6.1-3 未设定提醒 → 引导设定，不报错', async () => {
    const { configStore, stateStore } = reminderStores('61-3');
    const evaluation = await evaluateReminder({
      nowTimeProvider: async () => ({ data: nowAt('2026-10-10T12:00:00+08:00'), degraded: false }),
      deviceTimezone: 'Asia/Shanghai',
      configStore,
      stateStore,
    });
    expect(evaluation.decision.status).toBe('not-configured');
    expect(evaluation.message).toContain('还没有设定就餐提醒');
  });

  it('6.1-4 advanceMinutes：11:50 对 12:00 提前 10 分钟 → 触发', async () => {
    const { configStore, stateStore } = reminderStores('61-4');
    await setReminder({ mealType: 'lunch', time: '12:00', advanceMinutes: 10 }, configStore);
    const evaluation = await evaluateReminder({
      nowTimeProvider: async () => ({ data: nowAt('2026-10-10T11:50:00+08:00'), degraded: false }),
      deviceTimezone: 'Asia/Shanghai',
      configStore,
      stateStore,
    });
    expect(evaluation.decision.status).toBe('trigger');
  });

  it('6.1-5 quietHours：到点但处于免打扰区间 → 顺延', async () => {
    const { configStore, stateStore } = reminderStores('61-5');
    await setReminder(
      { mealType: 'lunch', time: '12:00', quietHours: { start: '12:00', end: '13:00' } },
      configStore,
    );
    const evaluation = await evaluateReminder({
      nowTimeProvider: async () => ({ data: nowAt('2026-10-10T12:05:00+08:00'), degraded: false }),
      deviceTimezone: 'Asia/Shanghai',
      configStore,
      stateStore,
    });
    expect(evaluation.decision.status).toBe('deferred');
    expect(evaluation.decision.reason).toBe('quiet-hours');
  });

  it('6.1-6 跨天：23:59 设定，次日 00:01 → 按当天逻辑尚未到点', async () => {
    const { configStore, stateStore } = reminderStores('61-6');
    await setReminder({ mealType: 'dinner', time: '23:59' }, configStore);
    const evaluation = await evaluateReminder({
      nowTimeProvider: async () => ({ data: nowAt('2026-10-11T00:01:00+08:00'), degraded: false }),
      deviceTimezone: 'Asia/Shanghai',
      configStore,
      stateStore,
    });
    expect(evaluation.decision.status).toBe('skip');
    expect(evaluation.decision.reason).toBe('not-due');
  });

  it('6.1-7 时区不一致 → 以设备时区判定并标注', async () => {
    const { configStore, stateStore } = reminderStores('61-7');
    await setReminder({ mealType: 'lunch', time: '12:00' }, configStore);
    const evaluation = await evaluateReminder({
      // UTC 04:00 == 东八区 12:00
      nowTimeProvider: async () => ({
        data: nowAt('2026-10-10T04:00:00Z', { timezone: 'UTC', offset: '+00:00' }),
        degraded: false,
      }),
      deviceTimezone: 'Asia/Shanghai',
      configStore,
      stateStore,
    });
    expect(evaluation.decision.status).toBe('trigger');
    expect(evaluation.decision.timezone).toBe('Asia/Shanghai');
    expect(evaluation.decision.timezoneMismatch).toBe(true);
    expect(evaluation.message).toContain('设备时区');
  });

  it('6.1-2 同一餐次当天已提醒 → 不再重复提醒', async () => {
    const { configStore, stateStore } = reminderStores('61-2');
    await setReminder({ mealType: 'lunch', time: '12:00' }, configStore);
    const provider = async () => ({ data: nowAt('2026-10-10T12:10:00+08:00'), degraded: false });
    const first = await evaluateReminder({
      nowTimeProvider: provider,
      deviceTimezone: 'Asia/Shanghai',
      configStore,
      stateStore,
    });
    expect(first.decision.status).toBe('trigger');
    const second = await evaluateReminder({
      nowTimeProvider: provider,
      deviceTimezone: 'Asia/Shanghai',
      configStore,
      stateStore,
    });
    expect(second.decision.status).toBe('skip');
    expect(second.decision.reason).toBe('already-reminded');
  });
});

describe('AC 6.2 套餐推荐', () => {
  it('6.2-1 返回 1 主推 + ≤2 备选 + ≥2 条理由', async () => {
    const { deps } = createFakeDeps();
    const result = await recommend({ profile: testProfile() }, deps);
    expect(result.recommendation.primary.code).toBeTruthy();
    expect(result.recommendation.alternatives.length).toBeLessThanOrEqual(2);
    expect(result.recommendation.reasons.length).toBeGreaterThanOrEqual(2);
  });

  it('6.2-2 存在可用券 → 展示券后价与节省金额', async () => {
    const { deps } = createFakeDeps();
    const result = await recommend({ profile: testProfile() }, deps);
    const primary = result.recommendation.primary;
    expect(primary.discount ?? 0).toBeGreaterThan(0);
    expect(primary.effectivePrice).toBeLessThan(primary.price);
  });

  it('6.2-3 热量上限：主推不超上限；无满足项时回退最接近并告知', async () => {
    const { deps } = createFakeDeps();
    const bounded = await recommend(
      {
        profile: testProfile({
          preferences: {
            categoryWeights: { 汉堡: 0.8 },
            priceBand: { min: 20, max: 40 },
            nutritionGoal: { maxKcal: 500 },
          },
        }),
      },
      deps,
    );
    expect(bounded.recommendation.primary.nutrition?.energyKcal ?? 0).toBeLessThanOrEqual(500);

    const { deps: deps2 } = createFakeDeps();
    const relaxed = await recommend(
      {
        profile: testProfile({
          preferences: {
            categoryWeights: {},
            priceBand: { min: 0, max: 0 },
            nutritionGoal: { maxKcal: 100 },
          },
        }),
      },
      deps2,
    );
    expect(relaxed.nutritionRelaxed).toBe(true);
    expect(relaxed.notices.join('')).toContain('热量上限');
  });

  it('6.2-4 不可售（无有效价格）不返回', async () => {
    const { candidates } = filterCandidates(
      [
        makeCandidate({ code: 'M0', price: 0, effectivePrice: 0 }),
        makeCandidate({ code: 'M9', price: 20, effectivePrice: 20 }),
      ],
      testProfile(),
    );
    expect(candidates.length).toBe(1);
    expect(candidates.every((candidate) => candidate.price > 0)).toBe(true);

    const { deps } = createFakeDeps({
      queryMeals: async () => ({
        data: { meals: { M001: { code: 'M001', name: '零价套餐', price: 0 } } },
        degraded: false,
      }),
      // 详情也不返回有效价格，确保候选仍为「不可售」
      queryMealDetail: async () => ({ data: { code: 'M001', name: '零价套餐' }, degraded: false }),
    });
    await expect(recommend({ profile: testProfile() }, deps)).rejects.toMatchObject({
      code: ErrorCode.EMPTY_RESULT,
    });
  });

  it('6.2-5 多样性：近期已选品类被降权', async () => {
    expect(noveltyFit('汉堡', ['汉堡', '汉堡', '汉堡'])).toBeCloseTo(0.2, 5);
    expect(noveltyFit('轻食', ['汉堡', '汉堡', '汉堡'])).toBe(1);
  });

  it('6.2-6 默认渠道：有地址走麦乐送，否则附近门店', async () => {
    expect(resolveChannel({ hasAddresses: true })).toBe('delivery');
    expect(resolveChannel({ hasAddresses: false })).toBe('nearby');
    expect(resolveChannel({ addressId: 'A1', hasAddresses: false })).toBe('delivery');

    const { deps } = createFakeDeps();
    const viaDelivery = await recommend({ profile: testProfile() }, deps);
    expect(viaDelivery.channel).toBe('delivery');

    const { deps: nearbyDeps } = createFakeDeps({
      deliveryQueryAddresses: async () => ({ data: [], degraded: false }),
    });
    const viaNearby = await recommend({ profile: testProfile() }, nearbyDeps);
    expect(viaNearby.channel).toBe('nearby');
  });
});

describe('AC 6.3 用户选择记录与偏好画像', () => {
  it('6.3-1 明确选择 → 品类 / 价格带权重增强', async () => {
    const store = createProfileStore(`${env.dir}/p631.json`);
    await recordChoice(
      {
        timestamp: '2026-10-10T12:00:00+08:00',
        storeCode: 'S1',
        mealCode: 'M001',
        mealName: '巨无霸套餐',
        effectivePrice: 30,
        category: '汉堡',
        source: 'explicit',
      },
      store,
    );
    const profile = await readProfile(store);
    expect(profile.preferences.categoryWeights['汉堡']).toBeGreaterThan(0);
    expect(profile.preferences.priceBand.max).toBeGreaterThan(0);
  });

  it('6.3-2 未明确选择 → 以推荐结果写入起始画像（弱权重）', async () => {
    const store = createProfileStore(`${env.dir}/p632.json`);
    await buildStartingProfile(makeCandidate(), store, 'S1');
    const profile = await readProfile(store);
    expect(profile.history[0]?.source).toBe('recommended');
  });

  it('6.3-3 画像损坏 → 回退空画像并重建，不报错', async () => {
    const path = `${env.dir}/p633.json`;
    await writeFile(path, '{ broken', 'utf8');
    const profile = await readProfile(createProfileStore(path));
    expect(profile.history).toEqual([]);
  });

  it('6.3-4 查看画像 → 脱敏可读摘要', async () => {
    const store = createProfileStore(`${env.dir}/p634.json`);
    await recordChoice(
      {
        timestamp: '2026-10-10T12:00:00+08:00',
        storeCode: 'S1001',
        mealCode: 'M001',
        mealName: '巨无霸套餐',
        effectivePrice: 30,
        category: '汉堡',
        source: 'explicit',
      },
      store,
    );
    const summary = await getProfileSummary(store);
    expect(summary.text.length).toBeGreaterThan(0);
    expect(summary.frequentStores[0]).not.toBe('S1001');
    expect(summary.frequentStores[0]).toContain('*');
  });
});

describe('AC 6.4 离线可复现模式', () => {
  it('6.4-1 无 Token 且未设 MCD_OFFLINE → 自动降级离线数据', async () => {
    const client = createMcpClient({ config: { offline: false, token: undefined } });
    const result = await client.nowTimeInfo();
    expect(result.degraded).toBe(true);
    await client.close();
  });

  it('6.4-3 离线数据在推荐结果中标注「离线/降级」', async () => {
    const { deps } = createFakeDeps({
      deliveryQueryStores: async () => ({ data: [{ storeCode: 'S1', beCode: '2' }], degraded: true }),
    });
    const result = await recommend({ profile: testProfile() }, deps);
    expect(result.recommendation.degraded).toBe(true);
    expect(result.notices.join('')).toContain('离线');
  });
});

describe('AC 6.5 优惠券领取（写操作需显式确认）', () => {
  it('6.5-1 推荐主链路不得自动调用 auto-bind-coupons', async () => {
    const { deps, spies } = createSkillDeps();
    await handleRequest({ action: 'recommend' }, deps);
    expect(spies.autoBindCoupons).toBe(0);
  });

  it('6.5-2 未确认不领券；显式确认后调用并反馈结果', async () => {
    const { deps, spies } = createSkillDeps();
    const pending = await handleRequest({ action: 'bind-coupons' }, deps);
    expect(spies.autoBindCoupons).toBe(0);
    expect(pending.text).toContain('确认');

    const confirmed = await handleRequest({ action: 'bind-coupons', confirmed: true }, deps);
    expect(spies.autoBindCoupons).toBe(1);
    expect(confirmed.bindResult?.length).toBeGreaterThan(0);
  });
});

describe('AC 6.6 非法输入', () => {
  it('6.6-1 非法时间格式 "25:99" → 拒绝且不写入配置', async () => {
    const response = await handleRequest({ action: 'set-reminder', mealType: 'lunch', time: '25:99' });
    expect(response.text).toContain('HH:mm');
    await expect(readFile(env.reminderConfigPath, 'utf8')).rejects.toBeTruthy();
  });

  it('6.6-2 负数热量上限/预算 → 拒绝并提示取值范围，不进入推荐', async () => {
    const { deps, spies } = createSkillDeps();
    const goalResponse = await handleRequest(
      { action: 'recommend', nutritionGoal: { maxKcal: -100 } },
      deps,
    );
    expect(spies.recommend).toBe(0);
    expect(goalResponse.recommendation).toBeUndefined();
    expect(goalResponse.text).toContain('营养目标不合法');

    const { deps: budgetDeps, spies: budgetSpies } = createSkillDeps();
    const budgetResponse = await handleRequest(
      { action: 'recommend', budget: { min: -1, max: 20 } },
      budgetDeps,
    );
    expect(budgetSpies.recommend).toBe(0);
    expect(budgetResponse.recommendation).toBeUndefined();
    expect(budgetResponse.text).toContain('预算不合法');
  });

  it('6.6-3 超长 keyword（>100 字符）→ 拒绝且不发起 MCP 调用', async () => {
    let transportCalls = 0;
    const transport: ToolTransport = {
      callTool: async () => {
        transportCalls += 1;
        return { text: JSON.stringify([{ storeCode: 'S1', beCode: '2' }]) };
      },
      close: async () => undefined,
    };
    const client = createMcpClient({ config: { offline: false, token: 'x' }, transport });
    await expect(client.queryNearbyStores({ keyword: 'x'.repeat(200) })).rejects.toThrow();
    expect(transportCalls).toBe(0);

    // Skill 入口同样拒绝超长 keyword（未触发推荐）
    const { deps, spies } = createSkillDeps();
    const response = await handleRequest(
      { action: 'recommend', keyword: 'x'.repeat(200) },
      deps,
    );
    expect(spies.recommend).toBe(0);
    expect(response.text).toContain('关键词不合法');
  });
});
