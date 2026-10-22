import { describe, expect, it } from 'vitest';

import {
  hhmmToMinutes,
  isInQuietHours,
  isSameTimezone,
  minutesToHhmm,
  nowToZonedClock,
  weekdayLabel,
} from '@/reminder/time';
import type { NowTimeInfo } from '@/types/index';

function nowAt(datetime: string, timezone = 'Asia/Shanghai', offset = '+08:00'): NowTimeInfo {
  const date = datetime.slice(0, 10);
  return { datetime, date, dayOfWeek: new Date(`${date}T00:00:00Z`).getUTCDay(), timezone, offset };
}

describe('hhmmToMinutes / minutesToHhmm', () => {
  it('解析与格式化互逆', () => {
    expect(hhmmToMinutes('12:05')).toBe(725);
    expect(minutesToHhmm(725)).toBe('12:05');
  });

  it('非法格式返回 NaN', () => {
    expect(Number.isNaN(hhmmToMinutes('25:99'))).toBe(true);
    expect(Number.isNaN(hhmmToMinutes('9:00'))).toBe(true);
  });

  it('负值与超界按 1440 取模', () => {
    expect(minutesToHhmm(-5)).toBe('23:55');
    expect(minutesToHhmm(1450)).toBe('00:10');
  });
});

describe('isSameTimezone', () => {
  it('忽略大小写与空白', () => {
    expect(isSameTimezone('Asia/Shanghai', 'asia/shanghai ')).toBe(true);
  });

  it('任一侧缺失时视为一致（避免误报）', () => {
    expect(isSameTimezone(undefined, 'Asia/Shanghai')).toBe(true);
  });

  it('不同时区返回 false', () => {
    expect(isSameTimezone('Asia/Shanghai', 'America/New_York')).toBe(false);
  });
});

describe('weekdayLabel', () => {
  it('映射 0-6 到中文', () => {
    expect(weekdayLabel(0)).toBe('周日');
    expect(weekdayLabel(6)).toBe('周六');
  });

  it('越界取模', () => {
    expect(weekdayLabel(7)).toBe('周日');
    expect(weekdayLabel(-1)).toBe('周六');
  });
});

describe('nowToZonedClock', () => {
  it('同时区裸墙钟直接采用', () => {
    const clock = nowToZonedClock(nowAt('2026-10-10 12:05:00'), 'Asia/Shanghai');
    expect(clock.date).toBe('2026-10-10');
    expect(clock.time).toBe('12:05');
    expect(clock.minutesOfDay).toBe(725);
    expect(clock.dayOfWeek).toBe(new Date(Date.UTC(2026, 9, 10)).getUTCDay());
  });

  it('显式 UTC 时刻投影到目标时区', () => {
    const clock = nowToZonedClock(nowAt('2026-10-10T04:05:00Z', 'UTC', '+00:00'), 'Asia/Shanghai');
    expect(clock.date).toBe('2026-10-10');
    expect(clock.time).toBe('12:05');
  });

  it('时区不一致时按偏移换算到判定时区', () => {
    const clock = nowToZonedClock(nowAt('2026-10-10T12:05:00+08:00'), 'America/New_York');
    expect(clock.date).toBe('2026-10-10');
    expect(clock.time).toBe('00:05');
  });

  it('datetime 不可解析时退化为 now.date', () => {
    const now: NowTimeInfo = {
      datetime: 'invalid',
      date: '2026-10-10',
      dayOfWeek: 6,
      timezone: 'Asia/Shanghai',
      offset: '+08:00',
    };
    const clock = nowToZonedClock(now, 'Asia/Shanghai');
    expect(clock.date).toBe('2026-10-10');
    expect(clock.time).toBe('00:00');
  });
});

describe('isInQuietHours', () => {
  it('同日区间', () => {
    expect(isInQuietHours(12 * 60, { start: '11:00', end: '13:00' })).toBe(true);
    expect(isInQuietHours(14 * 60, { start: '11:00', end: '13:00' })).toBe(false);
  });

  it('跨午夜区间', () => {
    expect(isInQuietHours(23 * 60, { start: '22:00', end: '07:00' })).toBe(true);
    expect(isInQuietHours(6 * 60, { start: '22:00', end: '07:00' })).toBe(true);
    expect(isInQuietHours(8 * 60, { start: '22:00', end: '07:00' })).toBe(false);
  });

  it('起止相同视为空区间', () => {
    expect(isInQuietHours(12 * 60, { start: '12:00', end: '12:00' })).toBe(false);
  });
});
