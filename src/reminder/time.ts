/**
 * 提醒时间与时区换算（纯函数，技术设计 §4.4）。
 *
 * 关键点：
 * - 判定所用时区为「用户设备时区」（`deviceTimezone`），当 MCP `now-time-info.timezone`
 *   与其不一致时以设备时区为准（需求 AC 6.1-7）；
 * - 将 `now-time-info` 的绝对时刻投影到判定时区，得到该时区下的**自然日 / 星期 / 墙钟时刻**，
 *   用于跨天判定（AC 6.1-6）；
 * - 全部为纯函数，便于单测覆盖时区 / 跨天 / 夏令时等边界。
 */

import type { NowTimeInfo, QuietHours } from '../types/index.js';

/** 判定时区下的墙钟信息 */
export interface ZonedClock {
  /** 'YYYY-MM-DD' */
  date: string;
  /** 0-6（周日=0） */
  dayOfWeek: number;
  /** 自当日 00:00 起的分钟数 */
  minutesOfDay: number;
  /** 'HH:mm' */
  time: string;
}

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** 星期中文标签（0-6，越界自动取模） */
export function weekdayLabel(dayOfWeek: number): string {
  const index = ((Math.trunc(dayOfWeek) % 7) + 7) % 7;
  return WEEKDAY_LABELS[index] as string;
}

/** 解析用户设备时区；不可用时回退 'UTC' */
export function resolveDeviceTimezone(): string {
  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return timezone && timezone.length > 0 ? timezone : 'UTC';
  } catch {
    return 'UTC';
  }
}

/** 以设备本地时间构造 `NowTimeInfo`（`now-time-info` 完全不可用时的兜底） */
export function deviceNowTimeInfo(): NowTimeInfo {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const offsetMinutes = -now.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  return {
    datetime: now.toISOString(),
    date,
    dayOfWeek: now.getDay(),
    timezone: resolveDeviceTimezone(),
    offset: `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`,
  };
}

function normalizeTimezone(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

/** 判断两个时区标识是否等价；任一侧缺失时视为「一致」（避免误报） */
export function isSameTimezone(a: string | undefined, b: string | undefined): boolean {
  const left = normalizeTimezone(a);
  const right = normalizeTimezone(b);
  if (left.length === 0 || right.length === 0) {
    return true;
  }
  return left === right;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** 'HH:mm' → 自 00:00 起的分钟数；非法格式或越界返回 NaN */
export function hhmmToMinutes(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    return Number.NaN;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    return Number.NaN;
  }
  return hours * 60 + minutes;
}

/** 分钟数 → 'HH:mm'（自动按 1440 取模，支持负数） */
export function minutesToHhmm(totalMinutes: number): string {
  const normalized = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(normalized / 60))}:${pad2(normalized % 60)}`;
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const WALL_CLOCK_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/;

function parseWallClock(value: string): WallClock | undefined {
  const match = WALL_CLOCK_PATTERN.exec(value.trim());
  if (!match) {
    return undefined;
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
  };
}

/** datetime 是否携带显式偏移（'Z' 或 '±HH:mm'） */
function hasExplicitOffset(value: string): boolean {
  const trimmed = value.trim();
  return /[zZ]$/.test(trimmed) || /[+-]\d{2}:?\d{2}$/.test(trimmed);
}

/** 从 '±HH:mm' 文本解析偏移分钟数；无法解析返回 undefined */
function offsetMinutesOf(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const match = /([+-])(\d{2}):?(\d{2})$/.exec(value.trim());
  if (!match) {
    return undefined;
  }
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

function clockFromWall(wall: WallClock): ZonedClock {
  const date = `${String(wall.year).padStart(4, '0')}-${pad2(wall.month)}-${pad2(wall.day)}`;
  const minutesOfDay = wall.hour * 60 + wall.minute;
  const dayOfWeek = new Date(Date.UTC(wall.year, wall.month - 1, wall.day)).getUTCDay();
  return { date, dayOfWeek, minutesOfDay, time: minutesToHhmm(minutesOfDay) };
}

/** 将绝对时刻投影到指定 IANA 时区；时区非法或环境不支持时返回 undefined */
function clockFromInstant(instantMs: number, timezone: string): ZonedClock | undefined {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    const parts: Record<string, string> = {};
    for (const part of formatter.formatToParts(new Date(instantMs))) {
      if (part.type !== 'literal') {
        parts[part.type] = part.value;
      }
    }
    const year = Number(parts.year);
    const month = Number(parts.month);
    const day = Number(parts.day);
    let hour = Number(parts.hour);
    const minute = Number(parts.minute);
    if (![year, month, day, hour, minute].every((value) => Number.isFinite(value))) {
      return undefined;
    }
    // 部分运行环境在午夜返回 '24'，归一到 '00'
    if (hour === 24) {
      hour = 0;
    }
    return clockFromWall({ year, month, day, hour, minute });
  } catch {
    return undefined;
  }
}

/**
 * 把 `now-time-info` 换算为判定时区下的墙钟。
 *
 * 决策顺序：
 * 1. `datetime` 含显式偏移（Z / ±HH:mm）→ 以绝对时刻投影到判定时区（最可靠）；
 * 2. `datetime` 为裸墙钟且 `now.timezone` 与判定时区一致 → 直接采用（无需换算）；
 * 3. 裸墙钟且 know 偏移可用 → 由偏移反推绝对时刻后投影到判定时区；
 * 4. 信息不足 → 以给定墙钟作 best-effort 处理。
 */
export function nowToZonedClock(now: NowTimeInfo, timezone: string): ZonedClock {
  const raw = now.datetime.trim();
  const wall = parseWallClock(raw);

  if (!wall) {
    // datetime 无法解析：退化为使用 now.date/dayOfWeek（时刻按 00:00）
    const fallbackDate = DATE_ONLY_PATTERN.test(now.date) ? now.date : new Date().toISOString().slice(0, 10);
    const dayOfWeek = Number.isInteger(now.dayOfWeek)
      ? ((now.dayOfWeek % 7) + 7) % 7
      : new Date(`${fallbackDate}T00:00:00Z`).getUTCDay();
    return { date: fallbackDate, dayOfWeek, minutesOfDay: 0, time: '00:00' };
  }

  if (hasExplicitOffset(raw)) {
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) {
      return clockFromInstant(parsed, timezone) ?? clockFromWall(wall);
    }
  }

  if (isSameTimezone(now.timezone, timezone)) {
    return clockFromWall(wall);
  }

  const offset = offsetMinutesOf(now.offset) ?? offsetMinutesOf(raw);
  if (offset !== undefined) {
    const instant = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute) - offset * 60_000;
    return clockFromInstant(instant, timezone) ?? clockFromWall(wall);
  }

  return clockFromWall(wall);
}

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 判断某时刻是否落在免打扰区间内（支持跨午夜区间；起止相同视为空区间） */
export function isInQuietHours(minutesOfDay: number, quiet: QuietHours): boolean {
  const start = hhmmToMinutes(quiet.start);
  const end = hhmmToMinutes(quiet.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) {
    return false;
  }
  if (start < end) {
    return minutesOfDay >= start && minutesOfDay < end;
  }
  // 跨午夜：如 22:00–07:00
  return minutesOfDay >= start || minutesOfDay < end;
}
