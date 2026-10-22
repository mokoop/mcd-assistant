/**
 * 画像 EMA（指数移动平均）计算（技术设计 §4.3）。
 *
 * 均为**纯函数**，不涉及 IO，便于单测与复用；`updatedAt` 与持久化由 profile.ts/store 统一负责。
 *
 * 更新公式：`新值 = (1 - α)·旧值 + α·目标值`
 * - 明确选择 → α_strong（强权重）；
 * - 未明确选择/采纳推荐 → α_weak（弱权重）。
 */

import type { MealType, PriceBand } from '../types/index.js';

/** 由选择时间派生的就餐时段 */
export type TimeSlot = 'breakfast' | 'lunch' | 'afternoon' | 'dinner' | 'night';

/**
 * 从 ISO8601 时间戳派生就餐时段。
 *
 * 换算策略：先将时间戳解析为绝对时刻（epoch），再换算到目标 IANA 时区的**本地小时**。
 * 因此对 `Z`（UTC）、`+08:00` 带偏移、以及无偏移的时间戳均能正确归类——
 * 这正是修复写入端 `new Date().toISOString()`（UTC）导致本地 12:30 被错标为 breakfast 的关键。
 *
 * @param timestamp ISO8601 时间戳
 * @param timeZone  目标 IANA 时区（如 `Asia/Shanghai`）；缺省使用设备时区
 * @returns 就餐时段；无法解析时返回 `null`（调用方据此跳过时段相关更新）
 */
export function deriveTimeSlot(timestamp: string, timeZone?: string): TimeSlot | null {
  const epochMs = Date.parse(timestamp);
  if (Number.isNaN(epochMs)) {
    return null;
  }
  const hour = hourInTimeZone(epochMs, resolveTimeZone(timeZone));
  if (hour === null) {
    return null;
  }
  return classifyHour(hour);
}

/** 解析目标时区：优先显式参数，其次设备时区，最终回退 UTC */
function resolveTimeZone(timeZone?: string): string {
  if (timeZone && timeZone.trim().length > 0) {
    return timeZone;
  }
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (resolved && resolved.length > 0) {
      return resolved;
    }
  } catch {
    // 运行环境不支持时区时回退 UTC
  }
  return 'UTC';
}

/** 取某绝对时刻在指定时区下的本地小时（0-23）；非法时区返回 null */
function hourInTimeZone(epochMs: number, timeZone: string): number | null {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      hourCycle: 'h23',
    });
    const hourPart = formatter.formatToParts(new Date(epochMs)).find((part) => part.type === 'hour');
    if (!hourPart) {
      return null;
    }
    const hour = Number(hourPart.value);
    if (!Number.isFinite(hour)) {
      return null;
    }
    return ((hour % 24) + 24) % 24;
  } catch {
    return null;
  }
}

/** 将本地小时归类为就餐时段 */
function classifyHour(hour: number): TimeSlot {
  if (hour >= 5 && hour < 11) {
    return 'breakfast';
  }
  if (hour >= 11 && hour < 15) {
    return 'lunch';
  }
  if (hour >= 15 && hour < 17) {
    return 'afternoon';
  }
  if (hour >= 17 && hour < 22) {
    return 'dinner';
  }
  return 'night';
}

/** 归一化权重：丢弃非正值并使权重之和为 1；全零时返回空对象 */
export function normalizeWeights(weights: Record<string, number>): Record<string, number> {
  const positive = Object.entries(weights).filter(([, value]) => value > 0);
  const sum = positive.reduce((acc, [, value]) => acc + value, 0);
  if (sum <= 0) {
    return {};
  }
  const normalized: Record<string, number> = {};
  for (const [key, value] of positive) {
    normalized[key] = value / sum;
  }
  return normalized;
}

/**
 * 品类权重 EMA 更新：命中品类目标值为 1，其余为 0，更新后归一化。
 */
export function updateCategoryWeights(
  weights: Record<string, number>,
  category: string,
  alpha: number,
): Record<string, number> {
  const decayed: Record<string, number> = {};
  for (const [key, value] of Object.entries(weights)) {
    decayed[key] = value * (1 - alpha);
  }
  decayed[category] = (decayed[category] ?? 0) + alpha;
  return normalizeWeights(decayed);
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * 价格带 EMA 滑动更新。
 *
 * 采用「价格带中心做 EMA + 固定带宽比展开」，而非直接对 min/max 做 EMA：
 * 后者在初始零宽价格带下会使 min 与 max 恒等，导致价格带坍塌失效。
 */
export function updatePriceBand(
  band: PriceBand,
  price: number,
  alpha: number,
  widthRatio: number,
): PriceBand {
  const hasBand = band.max > 0 || band.min > 0;
  const center = hasBand ? (band.min + band.max) / 2 : price;
  const nextCenter = hasBand ? (1 - alpha) * center + alpha * price : price;
  const half = Math.max(nextCenter * widthRatio, 0);
  return {
    min: Math.max(0, roundCurrency(nextCenter - half)),
    max: roundCurrency(nextCenter + half),
  };
}

/**
 * 餐次偏好 EMA 更新并归一化（仅 lunch/dinner）。
 */
export function updateMealTypePreference(
  preference: Record<MealType, number> | undefined,
  mealType: MealType,
  alpha: number,
): Record<MealType, number> {
  const base: Record<MealType, number> = { lunch: 0, dinner: 0, ...preference };
  const next: Record<MealType, number> = {
    lunch: base.lunch * (1 - alpha),
    dinner: base.dinner * (1 - alpha),
  };
  next[mealType] += alpha;
  const sum = next.lunch + next.dinner;
  if (sum <= 0) {
    return next;
  }
  return { lunch: next.lunch / sum, dinner: next.dinner / sum };
}

/**
 * 品类负反馈（v1.1.0 §2.5）：对命中品类权重做 EMA 衰减后再归一化。
 *
 * 公式：`w[category] = w[category]·(1 - β)`，其余品类不变，随后整体归一化。
 * 设计为**纯函数**且对非法输入（`β∉(0,1)`、无该品类、权重非正）**返回原权重**，
 * 保证负反馈永不产生非法画像（负值 / NaN）。
 */
export function applyNegativeSignal(
  weights: Record<string, number>,
  category: string,
  beta: number,
): Record<string, number> {
  if (!Number.isFinite(beta) || beta <= 0 || beta >= 1) {
    return weights;
  }
  if (!(category in weights)) {
    return weights;
  }
  const next: Record<string, number> = { ...weights };
  next[category] = (weights[category] ?? 0) * (1 - beta);
  return normalizeWeights(next);
}

/**
 * 合并标签（v1.2.0 泛化）：先移除 `remove`，再加入 `add`（去重、保留顺序）。
 * 用于口味标签与饮食禁忌/过敏原。
 */
export function mergeTags(current: string[], add: string[], remove: string[] = []): string[] {
  const removed = new Set(remove);
  const result = current.filter((tag) => !removed.has(tag));
  for (const tag of add) {
    if (tag.length > 0 && !result.includes(tag)) {
      result.push(tag);
    }
  }
  return result;
}

/** 合并口味标签（`mergeTags` 的语义化别名） */
export function mergeTasteTags(current: string[], add: string[], remove: string[] = []): string[] {
  return mergeTags(current, add, remove);
}
