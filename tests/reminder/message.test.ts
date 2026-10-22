import { describe, expect, it } from 'vitest';

import { judgeReminder } from '@/reminder/judge';
import { buildReminderGuideMessage, buildReminderMessage, formatActiveDays } from '@/reminder/message';
import type { NowTimeInfo, ReminderConfig, ReminderState } from '@/types/index';

function nowAt(datetime: string, timezone = 'Asia/Shanghai', offset = '+08:00'): NowTimeInfo {
  const date = datetime.slice(0, 10);
  return { datetime, date, dayOfWeek: new Date(`${date}T00:00:00Z`).getUTCDay(), timezone, offset };
}

function config(overrides: Partial<ReminderConfig> = {}): ReminderConfig {
  return { mealType: 'lunch', time: '12:00', days: [], enabled: true, ...overrides };
}

function messageFor(cfg: ReminderConfig | undefined, state: ReminderState, now: NowTimeInfo, device = 'Asia/Shanghai'): string {
  return buildReminderMessage({ decision: judgeReminder(cfg, state, now, device), ...(cfg ? { config: cfg } : {}) });
}

describe('formatActiveDays', () => {
  it('空数组表示每天', () => {
    expect(formatActiveDays([])).toBe('每天');
  });

  it('去重并按星期排序', () => {
    expect(formatActiveDays([3, 1, 1])).toBe('周一、周三');
  });
});

describe('buildReminderGuideMessage', () => {
  it('引导用户设定', () => {
    expect(buildReminderGuideMessage()).toContain('还没有设定就餐提醒');
  });
});

describe('buildReminderMessage', () => {
  it('未设定时返回引导（AC 6.1-3）', () => {
    expect(messageFor(undefined, {}, nowAt('2026-10-10T12:05:00+08:00'))).toContain('还没有设定就餐提醒');
  });

  it('到点触发文案包含餐次与时刻（AC 6.1-1）', () => {
    const text = messageFor(config(), {}, nowAt('2026-10-10T12:05:00+08:00'));
    expect(text).toContain('午餐');
    expect(text).toContain('12:05');
    expect(text).toContain('套餐');
  });

  it('提前提醒纳入文案（AC 6.1-4）', () => {
    const text = messageFor(config({ advanceMinutes: 10 }), {}, nowAt('2026-10-10T11:50:00+08:00'));
    expect(text).toContain('提前 10 分钟');
  });

  it('免打扰顺延文案（AC 6.1-5）', () => {
    const text = messageFor(
      config({ quietHours: { start: '11:00', end: '13:00' } }),
      {},
      nowAt('2026-10-10T12:05:00+08:00'),
    );
    expect(text).toContain('免打扰');
    expect(text).toContain('13:00');
  });

  it('已提醒不再重复文案（AC 6.1-2）', () => {
    const text = messageFor(
      config(),
      { lastRemindedMealType: 'lunch', lastRemindedDate: '2026-10-10' },
      nowAt('2026-10-10T12:05:00+08:00'),
    );
    expect(text).toContain('已经发过');
  });

  it('非生效日文案说明生效日', () => {
    const today = nowAt('2026-10-10T12:05:00+08:00').dayOfWeek;
    const text = messageFor(
      config({ days: [(today + 2) % 7] }),
      {},
      nowAt('2026-10-10T12:05:00+08:00'),
    );
    expect(text).toContain('仅设置在');
  });

  it('时区不一致时标注设备时区（AC 6.1-7）', () => {
    const text = messageFor(
      config(),
      {},
      nowAt('2026-10-10T04:05:00Z', 'UTC', '+00:00'),
      'Asia/Shanghai',
    );
    expect(text).toContain('已按你的设备时区 Asia/Shanghai 判定');
  });

  it('提醒关闭文案', () => {
    const text = messageFor(config({ enabled: false }), {}, nowAt('2026-10-10T12:05:00+08:00'));
    expect(text).toContain('关闭状态');
  });
});
