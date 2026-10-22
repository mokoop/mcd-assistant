/**
 * 到点判定（**纯函数**，技术设计 §4.4 / 需求 AC 6.1-1..7）。
 *
 * 判定公式：`now >= 设定时间 - advanceMinutes` 且不在 `quietHours` 内 → 触发。
 * 其余分支：
 * - 无配置 → `not-configured`（引导设定，不报错）；
 * - 已关闭 / 非生效日 / 同日同餐次已提醒 / 未到点 → `skip`；
 * - 到点但在免打扰区间 → `deferred`（顺延至区间结束）。
 */

import { hhmmToMinutes, isInQuietHours, isSameTimezone, minutesToHhmm, nowToZonedClock } from './time.js';

import type { NowTimeInfo, ReminderConfig, ReminderState } from '../types/index.js';

/** 判定结果状态 */
export type ReminderDecisionStatus = 'trigger' | 'deferred' | 'skip' | 'not-configured';

/** 判定原因（机器可读） */
export type ReminderReason =
  | 'not-configured'
  | 'disabled'
  | 'day-inactive'
  | 'already-reminded'
  | 'not-due'
  | 'quiet-hours'
  | 'due';

/** 到点判定结果 */
export interface ReminderDecision {
  status: ReminderDecisionStatus;
  reason: ReminderReason;
  /** 判定所用时区（设备时区优先） */
  timezone: string;
  /** `now-time-info.timezone` 与判定时区不一致（需在输出中标注） */
  timezoneMismatch: boolean;
  /** 判定时区下的自然日 'YYYY-MM-DD' */
  date: string;
  /** 判定时区下的星期（0-6，周日=0） */
  dayOfWeek: number;
  /** 判定时区下的当前时刻 'HH:mm' */
  nowTime: string;
  /** 设定时刻 'HH:mm'（无配置或缺省） */
  scheduledTime?: string;
  /** 计入提前量后的实际触发时刻 'HH:mm' */
  effectiveTime?: string;
  /** 免打扰顺延后的结束时刻 'HH:mm'（`deferred` 时） */
  deferredUntil?: string;
}

/**
 * 判断当前是否应触发就餐提醒。
 *
 * @param config 提醒配置（`undefined` 表示用户尚未设定）
 * @param state 上一次提醒状态（用于同日同餐次去重）
 * @param now `now-time-info` 返回的当前时间信息
 * @param deviceTimezone 用户设备时区（判定基准）
 */
export function judgeReminder(
  config: ReminderConfig | undefined,
  state: ReminderState,
  now: NowTimeInfo,
  deviceTimezone: string,
): ReminderDecision {
  // 判定时区：显式配置 > 用户设备时区 > MCP 返回时区
  const timezone = config?.timezone?.trim() || deviceTimezone || now.timezone;
  const timezoneMismatch = !isSameTimezone(now.timezone, timezone);
  const clock = nowToZonedClock(now, timezone);
  const base = {
    timezone,
    timezoneMismatch,
    date: clock.date,
    dayOfWeek: clock.dayOfWeek,
    nowTime: clock.time,
  };

  if (!config) {
    return { status: 'not-configured', reason: 'not-configured', ...base };
  }

  if (!config.enabled) {
    return { status: 'skip', reason: 'disabled', scheduledTime: config.time, ...base };
  }

  if (config.days.length > 0 && !config.days.includes(clock.dayOfWeek)) {
    return { status: 'skip', reason: 'day-inactive', scheduledTime: config.time, ...base };
  }

  // 去重：同一餐次、同一自然日已提醒 → 跳过（AC 6.1-2）
  if (state.lastRemindedMealType === config.mealType && state.lastRemindedDate === clock.date) {
    return { status: 'skip', reason: 'already-reminded', scheduledTime: config.time, ...base };
  }

  const scheduled = hhmmToMinutes(config.time);
  const advance = config.advanceMinutes ?? 0;
  const threshold = scheduled - advance;
  const effectiveTime = minutesToHhmm(threshold);

  // 未到点（含跨天：以判定时区自然日为准，AC 6.1-6）
  if (clock.minutesOfDay < threshold) {
    return { status: 'skip', reason: 'not-due', scheduledTime: config.time, effectiveTime, ...base };
  }

  // 到点但处于免打扰区间 → 顺延（AC 6.1-5）
  if (config.quietHours && isInQuietHours(clock.minutesOfDay, config.quietHours)) {
    return {
      status: 'deferred',
      reason: 'quiet-hours',
      scheduledTime: config.time,
      effectiveTime,
      deferredUntil: config.quietHours.end,
      ...base,
    };
  }

  return { status: 'trigger', reason: 'due', scheduledTime: config.time, effectiveTime, ...base };
}
