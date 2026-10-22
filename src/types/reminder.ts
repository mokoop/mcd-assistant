/**
 * 就餐提醒相关类型（对应技术设计 §2.1）
 */

import type { MealType } from './profile.js';

/** 免打扰区间（'HH:mm'，区间内不打扰） */
export interface QuietHours {
  start: string;
  end: string;
}

/** 提醒配置（用户设定） */
export interface ReminderConfig {
  mealType: MealType;
  /** 'HH:mm' */
  time: string;
  /** 0-6（周日=0），空数组=每天 */
  days: number[];
  enabled: boolean;
  /** 提前 N 分钟提醒（默认 0） */
  advanceMinutes?: number;
  /** 免打扰区间 */
  quietHours?: QuietHours;
  /** 判定所用时区（默认用户设备时区） */
  timezone?: string;
}

/** 提醒状态（去重，持久化至 data/reminder-state.json） */
export interface ReminderState {
  /** ISO8601 */
  lastRemindedAt?: string;
  lastRemindedMealType?: MealType;
  /** 'YYYY-MM-DD'（按判定时区） */
  lastRemindedDate?: string;
}
