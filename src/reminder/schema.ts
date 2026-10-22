/**
 * 提醒配置 / 状态的运行时校验（zod，需求 §6.6 / 技术设计 §3.2）。
 *
 * 作用：
 * - 拒绝非法输入（非法时间格式如 "25:99"、非法 `mealType` 等），**不写入配置**；
 * - 读取持久化文件时剔除未知字段，保证只有合法字段落盘。
 */

import { z } from 'zod';

import { AppError, ErrorCode } from '../core/errors.js';

import type { ReminderConfig, ReminderState } from '../types/index.js';

/** 'HH:mm'（24 小时制，00:00–23:59） */
export const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 餐次：lunch / dinner */
export const mealTypeSchema = z.enum(['lunch', 'dinner'], {
  errorMap: () => ({ message: '餐次只能是 lunch（午餐）或 dinner（晚餐）' }),
});

/** 时间点：'HH:mm' */
export const timeOfDaySchema = z
  .string({ invalid_type_error: '时间应为字符串' })
  .regex(TIME_OF_DAY_PATTERN, '时间格式应为 HH:mm（24 小时制，00:00–23:59）');

/** 免打扰区间 */
export const quietHoursSchema = z.object({
  start: timeOfDaySchema,
  end: timeOfDaySchema,
});

const dayOfWeekSchema = z
  .number({ invalid_type_error: '生效日应为 0–6 的整数' })
  .int('生效日应为整数')
  .min(0, '生效日应在 0–6 之间')
  .max(6, '生效日应在 0–6 之间');

/** 提醒配置 schema（`days` 空数组=每天；`enabled` 缺省=true） */
export const reminderConfigSchema = z.object({
  mealType: mealTypeSchema,
  time: timeOfDaySchema,
  days: z.array(dayOfWeekSchema).default([]),
  enabled: z.boolean({ invalid_type_error: 'enabled 应为布尔值' }).default(true),
  advanceMinutes: z
    .number({ invalid_type_error: '提前分钟数应为数字' })
    .int('提前分钟数应为整数')
    .min(0, '提前分钟数不能为负')
    .max(24 * 60, '提前分钟数不能超过 1440')
    .optional(),
  quietHours: quietHoursSchema.optional(),
  timezone: z.string().min(1, '时区不能为空').optional(),
});

/** 提醒配置输入类型（`days` / `enabled` 可省略，应用默认值） */
export type ReminderConfigInput = z.input<typeof reminderConfigSchema>;

/** 提醒状态 schema（去重） */
export const reminderStateSchema = z.object({
  lastRemindedAt: z.string().optional(),
  lastRemindedMealType: mealTypeSchema.optional(),
  lastRemindedDate: z.string().regex(DATE_PATTERN, '日期格式应为 YYYY-MM-DD').optional(),
});

/** 将 zod 校验错误整理为友好的中文提示（含字段路径） */
function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : '配置'}: ${issue.message}`)
    .join('；');
}

/**
 * 校验提醒配置；非法输入抛 `AppError(VALIDATION_ERROR)`（不返回、不写入）。
 */
export function parseReminderConfig(input: unknown): ReminderConfig {
  const result = reminderConfigSchema.safeParse(input);
  if (!result.success) {
    throw new AppError({
      code: ErrorCode.VALIDATION_ERROR,
      message: `提醒配置非法，已拒绝：${formatIssues(result.error)}`,
      cause: result.error,
    });
  }
  return result.data;
}

/** 校验提醒状态；非法结构抛 `AppError(VALIDATION_ERROR)`（由上层回退空状态）。 */
export function parseReminderState(input: unknown): ReminderState {
  const result = reminderStateSchema.safeParse(input);
  if (!result.success) {
    throw new AppError({
      code: ErrorCode.VALIDATION_ERROR,
      message: `提醒状态非法：${formatIssues(result.error)}`,
      cause: result.error,
    });
  }
  return result.data;
}
