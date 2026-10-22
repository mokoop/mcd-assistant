/**
 * 就餐提醒模块（scope: reminder）对外出口。
 *
 * 模块边界：仅依赖 `src/types`、`src/core` 与 `src/mcp-client`，**不依赖 recommender / profile**。
 *
 * 对外能力：
 * - 配置：`setReminder` / `getReminderConfig` / `clearReminder`；
 * - 到点判定：`judgeReminder`（纯函数）；
 * - 状态去重：`readReminderState` / `saveReminderState` / `markReminded`；
 * - 呈现：`buildReminderMessage` / `buildReminderGuideMessage` / `buildHostScheduleSuggestion`；
 * - 编排：`evaluateReminder`（读取配置与状态 → `now-time-info` → 判定 → 触发后持久化 → 组装文案与宿主建议）。
 */

import { logger } from '../core/logger.js';
import { nowTimeInfo, type ToolResult } from '../mcp-client/index.js';

import { getReminderConfig } from './config.js';
import { judgeReminder } from './judge.js';
import { buildReminderMessage } from './message.js';
import { buildHostScheduleSuggestion } from './schedule.js';
import { markReminded, readReminderState } from './state.js';
import { deviceNowTimeInfo, resolveDeviceTimezone } from './time.js';

import type { ReminderConfigStore } from './config.js';
import type { ReminderDecision } from './judge.js';
import type { HostScheduleSuggestion } from './schedule.js';
import type { ReminderStateStore } from './state.js';
import type { NowTimeInfo, ReminderConfig, ReminderState } from '../types/index.js';

export {
  clearReminder,
  createReminderConfigStore,
  getReminderConfig,
  resolveReminderConfigPath,
  resolveReminderStatePath,
  setReminder,
} from './config.js';
export { judgeReminder } from './judge.js';
export { buildReminderGuideMessage, buildReminderMessage, formatActiveDays } from './message.js';
export { buildHostScheduleSuggestion } from './schedule.js';
export { createReminderStateStore, markReminded, readReminderState, saveReminderState } from './state.js';
export { createJsonStore } from './store.js';
export { parseReminderConfig, parseReminderState, TIME_OF_DAY_PATTERN } from './schema.js';
export {
  deviceNowTimeInfo,
  hhmmToMinutes,
  isInQuietHours,
  isSameTimezone,
  minutesToHhmm,
  nowToZonedClock,
  resolveDeviceTimezone,
  weekdayLabel,
} from './time.js';

export type { ReminderConfigStore } from './config.js';
export type { ReminderDecision, ReminderDecisionStatus, ReminderReason } from './judge.js';
export type { ReminderMessageInput } from './message.js';
export type { HostScheduleSuggestion } from './schedule.js';
export type { JsonStore, JsonStoreOptions } from './store.js';
export type { ReminderStateStore } from './state.js';
export type { ReminderConfigInput } from './schema.js';
export type { ZonedClock } from './time.js';

/** `evaluateReminder` 选项（测试可注入时间源 / 时区 / 存储） */
export interface EvaluateReminderOptions {
  /** `now-time-info` 提供者（默认走 mcp-client 单例） */
  nowTimeProvider?: () => Promise<ToolResult<NowTimeInfo>>;
  /** 用户设备时区（默认取运行环境时区） */
  deviceTimezone?: string;
  /** 触发后是否持久化去重状态（默认 true） */
  persist?: boolean;
  /** 提醒配置存储（默认按环境变量路径） */
  configStore?: ReminderConfigStore;
  /** 提醒状态存储（默认按环境变量路径） */
  stateStore?: ReminderStateStore;
}

/** `evaluateReminder` 结果 */
export interface ReminderEvaluation {
  /** 当前提醒配置（未设定时缺省） */
  config?: ReminderConfig;
  /** 判定后的提醒状态（触发时已更新） */
  state: ReminderState;
  decision: ReminderDecision;
  /** 面向用户的提醒 / 引导文案 */
  message: string;
  /** 宿主定时建议（失败时降级为对话触发式） */
  schedule: HostScheduleSuggestion;
  /** `now-time-info` 是否来自离线 / 本地兜底 */
  degraded: boolean;
}

/**
 * 端到端评估一次就餐提醒：读取配置与状态 → 获取当前时间 → 到点判定 →
 * （触发时）持久化去重状态 → 组装文案与宿主定时建议。
 *
 * 健壮性：`now-time-info` 调用异常时回退设备本地时间并标记 `degraded`，不抛错。
 */
export async function evaluateReminder(options: EvaluateReminderOptions = {}): Promise<ReminderEvaluation> {
  const persist = options.persist ?? true;
  const config = await getReminderConfig(options.configStore);
  const state = await readReminderState(options.stateStore);

  const provider = options.nowTimeProvider ?? nowTimeInfo;
  let result: ToolResult<NowTimeInfo>;
  let degraded: boolean;
  try {
    result = await provider();
    degraded = result.degraded;
  } catch (error) {
    logger.warn('now-time-info 调用失败，回退设备本地时间', { error });
    result = { data: deviceNowTimeInfo(), degraded: true };
    degraded = true;
  }

  const deviceTimezone = options.deviceTimezone ?? resolveDeviceTimezone();
  const decision = judgeReminder(config, state, result.data, deviceTimezone);

  let finalState = state;
  if (config && decision.status === 'trigger' && persist) {
    finalState = await markReminded(config.mealType, decision.date, undefined, options.stateStore);
  }

  const message = buildReminderMessage({ decision, ...(config ? { config } : {}) });
  const schedule = buildHostScheduleSuggestion(config);

  return {
    ...(config ? { config } : {}),
    state: finalState,
    decision,
    message,
    schedule,
    degraded,
  };
}
