import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createReminderConfigStore } from '@/reminder/config';
import { evaluateReminder } from '@/reminder/index';
import { createReminderStateStore } from '@/reminder/state';
import type { NowTimeInfo } from '@/types/index';

let dir: string;
let configStore: ReturnType<typeof createReminderConfigStore>;
let stateStore: ReturnType<typeof createReminderStateStore>;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mcd-reminder-eval-'));
  configStore = createReminderConfigStore(join(dir, 'reminder-config.json'));
  stateStore = createReminderStateStore(join(dir, 'reminder-state.json'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function provider(datetime: string, degraded = false): () => Promise<{ data: NowTimeInfo; degraded: boolean }> {
  const date = datetime.slice(0, 10);
  const data: NowTimeInfo = {
    datetime,
    date,
    dayOfWeek: new Date(`${date}T00:00:00Z`).getUTCDay(),
    timezone: 'Asia/Shanghai',
    offset: '+08:00',
  };
  return () => Promise.resolve({ data, degraded });
}

describe('evaluateReminder', () => {
  it('到点触发、持久化去重状态并组装文案与宿主建议', async () => {
    await configStore.write({ mealType: 'lunch', time: '12:00', days: [], enabled: true });

    const result = await evaluateReminder({
      configStore,
      stateStore,
      nowTimeProvider: provider('2026-10-10T12:05:00+08:00'),
      deviceTimezone: 'Asia/Shanghai',
    });

    expect(result.decision.status).toBe('trigger');
    expect(result.state.lastRemindedMealType).toBe('lunch');
    expect(result.state.lastRemindedDate).toBe('2026-10-10');
    expect(result.message).toContain('午餐');
    expect(result.schedule.mode).toBe('host-cron');
    expect(result.degraded).toBe(false);
    await expect(stateStore.read()).resolves.toMatchObject({
      lastRemindedMealType: 'lunch',
      lastRemindedDate: '2026-10-10',
    });
  });

  it('同一自然日再次评估则去重跳过（AC 6.1-2）', async () => {
    await configStore.write({ mealType: 'lunch', time: '12:00', days: [], enabled: true });
    const now = provider('2026-10-10T12:05:00+08:00');

    await evaluateReminder({ configStore, stateStore, nowTimeProvider: now, deviceTimezone: 'Asia/Shanghai' });
    const second = await evaluateReminder({
      configStore,
      stateStore,
      nowTimeProvider: now,
      deviceTimezone: 'Asia/Shanghai',
    });

    expect(second.decision.status).toBe('skip');
    expect(second.decision.reason).toBe('already-reminded');
  });

  it('persist=false 时不写入去重状态', async () => {
    await configStore.write({ mealType: 'lunch', time: '12:00', days: [], enabled: true });

    await evaluateReminder({
      configStore,
      stateStore,
      nowTimeProvider: provider('2026-10-10T12:05:00+08:00'),
      deviceTimezone: 'Asia/Shanghai',
      persist: false,
    });

    await expect(stateStore.read()).resolves.toEqual({});
  });

  it('未配置提醒时引导且不写入状态（AC 6.1-3）', async () => {
    const result = await evaluateReminder({
      configStore,
      stateStore,
      nowTimeProvider: provider('2026-10-10T12:05:00+08:00'),
      deviceTimezone: 'Asia/Shanghai',
    });

    expect(result.decision.status).toBe('not-configured');
    expect(result.config).toBeUndefined();
    expect(result.message).toContain('还没有设定就餐提醒');
    await expect(stateStore.read()).resolves.toEqual({});
  });

  it('now-time-info 异常时回退本地时间并标记 degraded，不抛错', async () => {
    await configStore.write({ mealType: 'lunch', time: '00:00', days: [], enabled: true });

    const result = await evaluateReminder({
      configStore,
      stateStore,
      deviceTimezone: 'Asia/Shanghai',
      nowTimeProvider: () => Promise.reject(new Error('boom')),
    });

    expect(result.degraded).toBe(true);
    expect(result.decision.status).toBe('trigger');
  });
});
