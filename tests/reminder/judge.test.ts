import { describe, expect, it } from 'vitest';

import { judgeReminder } from '@/reminder/judge';
import type { NowTimeInfo, ReminderConfig } from '@/types/index';

function nowAt(datetime: string, timezone = 'Asia/Shanghai', offset = '+08:00'): NowTimeInfo {
  const date = datetime.slice(0, 10);
  return { datetime, date, dayOfWeek: new Date(`${date}T00:00:00Z`).getUTCDay(), timezone, offset };
}

function config(overrides: Partial<ReminderConfig> = {}): ReminderConfig {
  return { mealType: 'lunch', time: '12:00', days: [], enabled: true, ...overrides };
}

describe('judgeReminder', () => {
  it('到点后触发（AC 6.1-1）', () => {
    const decision = judgeReminder(config(), {}, nowAt('2026-10-10T12:05:00+08:00'), 'Asia/Shanghai');
    expect(decision.status).toBe('trigger');
    expect(decision.reason).toBe('due');
    expect(decision.date).toBe('2026-10-10');
    expect(decision.nowTime).toBe('12:05');
    expect(decision.scheduledTime).toBe('12:00');
    expect(decision.effectiveTime).toBe('12:00');
    expect(decision.timezoneMismatch).toBe(false);
  });

  it('未设定提醒时引导而非报错（AC 6.1-3）', () => {
    const decision = judgeReminder(undefined, {}, nowAt('2026-10-10T12:05:00+08:00'), 'Asia/Shanghai');
    expect(decision.status).toBe('not-configured');
    expect(decision.reason).toBe('not-configured');
  });

  it('提醒已关闭时跳过', () => {
    const decision = judgeReminder(config({ enabled: false }), {}, nowAt('2026-10-10T12:05:00+08:00'), 'Asia/Shanghai');
    expect(decision.status).toBe('skip');
    expect(decision.reason).toBe('disabled');
  });

  it('提前提醒：11:50 触发（AC 6.1-4）', () => {
    const decision = judgeReminder(
      config({ advanceMinutes: 10 }),
      {},
      nowAt('2026-10-10T11:50:00+08:00'),
      'Asia/Shanghai',
    );
    expect(decision.status).toBe('trigger');
    expect(decision.effectiveTime).toBe('11:50');
  });

  it('提前提醒：未到提前点则跳过', () => {
    const decision = judgeReminder(
      config({ advanceMinutes: 10 }),
      {},
      nowAt('2026-10-10T11:49:00+08:00'),
      'Asia/Shanghai',
    );
    expect(decision.status).toBe('skip');
    expect(decision.reason).toBe('not-due');
  });

  it('免打扰区间内顺延（AC 6.1-5）', () => {
    const decision = judgeReminder(
      config({ quietHours: { start: '11:00', end: '13:00' } }),
      {},
      nowAt('2026-10-10T12:05:00+08:00'),
      'Asia/Shanghai',
    );
    expect(decision.status).toBe('deferred');
    expect(decision.reason).toBe('quiet-hours');
    expect(decision.deferredUntil).toBe('13:00');
  });

  it('跨午夜免打扰区间顺延', () => {
    const decision = judgeReminder(
      config({ time: '23:00', quietHours: { start: '22:00', end: '07:00' } }),
      {},
      nowAt('2026-10-10T23:00:00+08:00'),
      'Asia/Shanghai',
    );
    expect(decision.status).toBe('deferred');
    expect(decision.deferredUntil).toBe('07:00');
  });

  it('非生效日跳过', () => {
    const today = nowAt('2026-10-10T12:05:00+08:00').dayOfWeek;
    const decision = judgeReminder(
      config({ days: [(today + 1) % 7] }),
      {},
      nowAt('2026-10-10T12:05:00+08:00'),
      'Asia/Shanghai',
    );
    expect(decision.status).toBe('skip');
    expect(decision.reason).toBe('day-inactive');
  });

  it('同餐次同日已提醒则跳过（AC 6.1-2）', () => {
    const decision = judgeReminder(
      config(),
      { lastRemindedMealType: 'lunch', lastRemindedDate: '2026-10-10' },
      nowAt('2026-10-10T12:05:00+08:00'),
      'Asia/Shanghai',
    );
    expect(decision.status).toBe('skip');
    expect(decision.reason).toBe('already-reminded');
  });

  it('不同餐次已提醒不阻止本餐次', () => {
    const decision = judgeReminder(
      config({ mealType: 'lunch' }),
      { lastRemindedMealType: 'dinner', lastRemindedDate: '2026-10-10' },
      nowAt('2026-10-10T12:05:00+08:00'),
      'Asia/Shanghai',
    );
    expect(decision.status).toBe('trigger');
  });

  it('跨天：23:59 设定在次日 00:01 视为未到点（AC 6.1-6）', () => {
    const decision = judgeReminder(config({ time: '23:59' }), {}, nowAt('2026-10-11T00:01:00+08:00'), 'Asia/Shanghai');
    expect(decision.status).toBe('skip');
    expect(decision.reason).toBe('not-due');
    expect(decision.date).toBe('2026-10-11');
  });

  it('时区不一致时以配置时区判定并标注（AC 6.1-7）', () => {
    const decision = judgeReminder(
      config({ timezone: 'America/New_York' }),
      {},
      nowAt('2026-10-10T12:05:00+08:00', 'Asia/Shanghai'),
      'Asia/Shanghai',
    );
    expect(decision.timezone).toBe('America/New_York');
    expect(decision.timezoneMismatch).toBe(true);
    expect(decision.nowTime).toBe('00:05');
    expect(decision.status).toBe('skip');
    expect(decision.reason).toBe('not-due');
  });

  it('未配置时区时以设备时区判定（AC 6.1-7）', () => {
    const decision = judgeReminder(config(), {}, nowAt('2026-10-10T12:05:00+08:00', 'Asia/Shanghai'), 'America/New_York');
    expect(decision.timezone).toBe('America/New_York');
    expect(decision.timezoneMismatch).toBe(true);
    expect(decision.nowTime).toBe('00:05');
  });
});
