/**
 * 集成测试 B：异常与恢复路径（对照技术设计 §5 异常与恢复策略 / 需求 §6.6 边界与异常）。
 *
 * 覆盖：无 Token、401、429 退避、超时、解析失败（关键 vs 可选）、券互斥、
 * 画像损坏、提醒状态损坏、无可售门店 —— 一律断言「不崩溃且有降级 / 友好结果」。
 */

import { rm, writeFile } from 'node:fs/promises';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppError, ErrorCode } from '@/core/errors';
import { handleRequest } from '@/index';
import { createMcpClient } from '@/mcp-client/tools';
import type { ToolTransport } from '@/mcp-client/types';
import { createProfileStore, readProfile } from '@/profile/index';
import { resolveRecommenderConfig } from '@/recommender/config';
import { applyCouponPricing } from '@/recommender/coupons';
import {
  createReminderConfigStore,
  createReminderStateStore,
  evaluateReminder,
} from '@/reminder/index';
import type { StoreInfo } from '@/types/index';

import { createFakeDeps } from '../recommender/fake-deps.js';

import { createSkillDeps, createTempEnv, makeCandidate, type TempEnv } from './helpers.js';

const base = { storeCode: 'S1', beCode: '2', orderType: 2 as const, beType: 2 };

let env: TempEnv;

beforeAll(async () => {
  env = await createTempEnv('mcd-qa-err-');
});

afterAll(async () => {
  await rm(env.dir, { recursive: true, force: true });
});

describe('集成 · 异常路径', () => {
  it('无 Token：自动降级离线数据（degraded=true），不抛错', async () => {
    const client = createMcpClient({ config: { offline: false, token: undefined } });
    const result = await client.nowTimeInfo();
    expect(result.degraded).toBe(true);
    expect(result.data.datetime).toBeTruthy();
    await client.close();
  });

  it('401 鉴权失败：降级离线数据', async () => {
    const transport: ToolTransport = {
      callTool: async () => {
        throw Object.assign(new Error('unauthorized'), { status: 401 });
      },
      close: async () => undefined,
    };
    const client = createMcpClient({ config: { offline: false, token: 'x', maxRetries: 0 }, transport });
    const result = await client.queryMeals(base);
    expect(result.degraded).toBe(true);
    expect(Object.keys(result.data.meals).length).toBeGreaterThan(0);
  });

  it('429 限流：指数退避重试至上限后降级', async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const transport: ToolTransport = {
      callTool: async () => {
        calls += 1;
        throw Object.assign(new Error('rate limited'), { status: 429 });
      },
      close: async () => undefined,
    };
    const client = createMcpClient({
      config: { offline: false, token: 'x', maxRetries: 2, backoffBaseMs: 10 },
      transport,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    const result = await client.queryMeals(base);
    expect(calls).toBe(3); // 1 次首发 + 2 次重试
    expect(sleeps).toEqual([10, 20]); // 指数退避 base·2^attempt
    expect(result.degraded).toBe(true);
  });

  it('超时：有限重试失败后降级', async () => {
    const transport: ToolTransport = {
      callTool: () => new Promise(() => undefined),
      close: async () => undefined,
    };
    const client = createMcpClient({
      config: { offline: false, token: 'x', maxRetries: 0, timeoutMs: 5 },
      transport,
    });
    const result = await client.nowTimeInfo();
    expect(result.degraded).toBe(true);
  });

  it('解析失败：可选工具视为空结果不中断；关键工具抛 PARSE_ERROR', async () => {
    const transport: ToolTransport = {
      callTool: async () => ({ text: '这不是任何可解析的结构' }),
      close: async () => undefined,
    };
    const client = createMcpClient({ config: { offline: false, token: 'x' }, transport });

    const nutrition = await client.listNutritionFoods();
    expect(nutrition.data).toEqual([]);
    expect(nutrition.degraded).toBe(false);

    await expect(client.nowTimeInfo()).rejects.toMatchObject({ code: ErrorCode.PARSE_ERROR });
  });

  it('now-time-info 调用异常：evaluateReminder 回退设备时间且不崩溃', async () => {
    const configStore = createReminderConfigStore(env.reminderConfigPath);
    const stateStore = createReminderStateStore(env.reminderStatePath);
    await configStore.write({ mealType: 'lunch', time: '00:00', days: [], enabled: true });

    const evaluation = await evaluateReminder({
      nowTimeProvider: async () => {
        throw new Error('boom');
      },
      deviceTimezone: 'Asia/Shanghai',
      configStore,
      stateStore,
    });
    expect(evaluation.degraded).toBe(true);
    expect(evaluation.decision.status).toBeDefined();
  });

  it('券互斥：以 calculate-price 实际试算结果为准，不臆造折扣', async () => {
    const store: StoreInfo = { storeCode: 'S1', beCode: '2' };
    const candidate = makeCandidate({ price: 39, effectivePrice: 39, discount: undefined });

    // 存在「立减8」券，但实际试算返回无优惠（模拟互斥/不适用）
    const { deps } = createFakeDeps({
      availableCoupons: async () => ({
        data: [{ couponId: 'C1', couponCode: 'SAVE8', name: '立减8', discount: '8' }],
        degraded: false,
      }),
      queryStoreCoupons: async () => ({ data: [], degraded: false }),
      queryMyCoupons: async () => ({ data: [], degraded: false }),
      calculatePrice: async () => ({
        data: { originalPrice: 39, discount: 0, price: 39 },
        degraded: false,
      }),
    });
    const result = await applyCouponPricing({
      deps,
      store,
      channel: 'delivery',
      topCandidates: [candidate],
      config: resolveRecommenderConfig(),
    });
    expect(result.trials).toBe(1);
    expect(candidate.effectivePrice).toBe(39);
    expect(candidate.discount).toBe(0);
  });

  it('画像文件损坏：回退默认空画像，不抛错', async () => {
    const path = `${env.dir}/broken-profile.json`;
    await writeFile(path, '{ 这不是合法 JSON', 'utf8');
    const store = createProfileStore(path);
    const profile = await readProfile(store);
    expect(profile.history).toEqual([]);
    expect(profile.preferences.categoryWeights).toEqual({});
  });

  it('提醒状态损坏：回退空状态，不抛错', async () => {
    const path = `${env.dir}/broken-state.json`;
    await writeFile(path, '{ bad', 'utf8');
    const store = createReminderStateStore(path);
    const state = await store.read();
    expect(state).toEqual({});
  });

  it('无可售门店：友好提示且不崩溃（含切换/重试建议）', async () => {
    const { deps } = createSkillDeps({
      recommend: async () => {
        throw new AppError({ code: ErrorCode.EMPTY_RESULT, message: '未找到可用门店' });
      },
    });
    const response = await handleRequest({ action: 'recommend' }, deps);
    expect(response.text).toContain('门店');
    expect(response.notices.length).toBeGreaterThan(0);
  });
});
