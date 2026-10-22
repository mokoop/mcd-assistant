/**
 * 宿主定时配置建议（技术设计 §4.4 / §9，需求 §6.1「可选宿主定时」）。
 *
 * Skill 无后台常驻，本模块产出**可选**的宿主定时（cron）建议，
 * 供 WorkBuddy 等宿主配置定时唤起；任何异常都**降级为对话触发式**，不报错。
 */

import { hhmmToMinutes, minutesToHhmm } from './time.js';

import type { ReminderConfig } from '../types/index.js';

/** 宿主定时建议 */
export interface HostScheduleSuggestion {
  /** 是否成功给出宿主定时建议 */
  available: boolean;
  /** host-cron=可定时唤起；dialog-triggered=降级为对话触发式 */
  mode: 'host-cron' | 'dialog-triggered';
  /** cron 表达式（5 段：分 时 日 月 周），`mode=host-cron` 时存在 */
  cronExpression?: string;
  /** 触发时刻 'HH:mm' */
  triggerTime?: string;
  /** 时区（沿用配置，缺省由宿主决定） */
  timezone?: string;
  /** 可读说明（含降级提示） */
  description: string;
}

const DIALOG_FALLBACK =
  '若宿主不支持定时唤起，将自动降级为对话触发式：用户开启对话时判断是否到点。';

/**
 * 生成宿主定时配置建议（纯函数、永不抛错）。
 *
 * cron 的 day-of-week 采用 0=周日，与 `ReminderConfig.days` 语义一致；`days` 为空表示每天（`*`）。
 */
export function buildHostScheduleSuggestion(config: ReminderConfig | undefined): HostScheduleSuggestion {
  try {
    if (!config || !config.enabled) {
      return {
        available: false,
        mode: 'dialog-triggered',
        description: `当前未启用就餐提醒。${DIALOG_FALLBACK}`,
      };
    }

    const scheduled = hhmmToMinutes(config.time);
    if (!Number.isFinite(scheduled)) {
      return {
        available: false,
        mode: 'dialog-triggered',
        description: `提醒时间格式无效，无法生成定时建议。${DIALOG_FALLBACK}`,
      };
    }

    const advance = config.advanceMinutes ?? 0;
    const triggerMinutes = ((scheduled - advance) % 1440 + 1440) % 1440;
    const hour = Math.floor(triggerMinutes / 60);
    const minute = triggerMinutes % 60;
    const dayOfWeek = config.days.length > 0 ? [...new Set(config.days)].sort((a, b) => a - b).join(',') : '*';
    const cronExpression = `${minute} ${hour} * * ${dayOfWeek}`;
    const triggerTime = minutesToHhmm(triggerMinutes);
    const timezone = config.timezone?.trim();
    const advanceNote = advance > 0 ? `，已按设定提前 ${advance} 分钟` : '';

    return {
      available: true,
      mode: 'host-cron',
      cronExpression,
      triggerTime,
      ...(timezone ? { timezone } : {}),
      description: `可选宿主定时建议：按 cron「${cronExpression}」（触发时刻 ${triggerTime}${advanceNote}）唤起 Skill。${DIALOG_FALLBACK}`,
    };
  } catch {
    return {
      available: false,
      mode: 'dialog-triggered',
      description: `生成宿主定时建议失败，已降级为对话触发式。${DIALOG_FALLBACK}`,
    };
  }
}
