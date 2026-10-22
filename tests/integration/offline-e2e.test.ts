/**
 * 集成测试 A：离线全链路（`MCD_OFFLINE=1`）——「提醒 → 推荐 → 记录画像」。
 *
 * 关键断言（对照技术设计 §1.3 数据流 / §5 异常恢复 / 需求 AC 6.4-2）：
 * 1. 使用真实模块默认接线（`handleRequest` 默认依赖）+ 临时数据路径，跑通完整闭环；
 * 2. **零 MCP 调用**：以带计数器的假传输替换 `createSdkTransport`，断言其 `callTool` 从未被调用；
 * 3. `degraded=true` 且输出明确标注「离线演示数据」。
 *
 * 说明：故意同时注入一个假 Token，以便在「离线短路」被误删时可被计数器捕获（否则无 Token 也会在连接前失败而无法暴露回归）。
 */

import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { handleRequest } from '@/index';
import type { UserProfile } from '@/types/index';

import { createTempEnv, type TempEnv } from './helpers.js';

const transport = vi.hoisted(() => ({
  count: 0,
  calls: [] as Array<{ name: string; args: Record<string, unknown> }>,
}));

vi.mock('@/mcp-client/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/mcp-client/client')>();
  return {
    ...actual,
    createSdkTransport: () => ({
      callTool: async (name: string, args: Record<string, unknown>) => {
        transport.count += 1;
        transport.calls.push({ name, args });
        return { text: '' };
      },
      close: async () => undefined,
    }),
  };
});

const ENV_KEYS = [
  'MCD_OFFLINE',
  'MCD_MCP_TOKEN',
  'MCD_PROFILE_PATH',
  'MCD_REMINDER_CONFIG_PATH',
  'MCD_REMINDER_STATE_PATH',
] as const;

let env: TempEnv;
let saved: Record<string, string | undefined> = {};

beforeAll(async () => {
  env = await createTempEnv('mcd-qa-e2e-');
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env.MCD_OFFLINE = '1';
  process.env.MCD_MCP_TOKEN = 'dummy-token-zero-call-guard';
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

describe('集成 · 离线全链路（MCD_OFFLINE=1）', () => {
  it('提醒→推荐→记录画像 跑通，且零 MCP 调用、degraded=true', async () => {
    transport.count = 0;
    transport.calls.length = 0;

    const setRes = await handleRequest({ action: 'set-reminder', mealType: 'lunch', time: '00:00' });
    expect(setRes.action).toBe('set-reminder');

    // 对话式：到点 → 提醒 + 推荐；accepted=true → 以推荐结果写入起始画像
    const chat = await handleRequest({ accepted: true });
    expect(chat.action).toBe('chat');
    expect(chat.reminder?.decision.status).toBe('trigger');
    expect(chat.recommendation).toBeDefined();
    expect(chat.recommendation?.primary.code).toBeTruthy();
    expect(chat.recommendation?.reasons.length).toBeGreaterThanOrEqual(2);
    expect(chat.recommendation?.degraded).toBe(true);
    expect(chat.degraded).toBe(true);
    expect(chat.text).toContain('推荐');
    expect(chat.text).toContain('离线');

    // 零 MCP 调用（含写操作 auto-bind-coupons 不得出现）
    expect(transport.count).toBe(0);
    expect(transport.calls.find((call) => call.name === 'auto-bind-coupons')).toBeUndefined();

    // 画像已落盘（弱权重起始画像）
    const profile = JSON.parse(await readFile(join(env.dir, 'profile.json'), 'utf8')) as UserProfile;
    expect(profile.history.length).toBe(1);
    expect(profile.history[0]?.source).toBe('recommended');

    // 同日同餐次再次对话 → 不重复提醒、不再推荐（AC 6.1-2）
    const again = await handleRequest({});
    expect(again.reminder?.decision.reason).toBe('already-reminded');
    expect(again.recommendation).toBeUndefined();
    expect(again.text).toContain('已经发过');
  });

  it('离线模式强制不发起任何 MCP 调用（显式 action=recommend）', async () => {
    transport.count = 0;
    transport.calls.length = 0;
    const res = await handleRequest({ action: 'recommend' });
    expect(res.action).toBe('recommend');
    expect(res.recommendation?.degraded).toBe(true);
    expect(transport.count).toBe(0);
  });
});
