/**
 * profile 模块可调参数（技术设计 §4.2/§4.3、需求 §7「可配置性」）。
 *
 * 说明：EMA 系数、history 保留条数、价格带宽比等集中于此，禁止散落硬编码；
 * 支持通过环境变量覆盖，便于实现后按压测结果校准。
 */

import { resolveDataPath } from '../core/paths.js';

/** profile 模块配置 */
export interface ProfileConfig {
  /** 明确选择的 EMA 系数（强权重，默认 0.4） */
  alphaStrong: number;
  /** 未明确选择/采纳推荐的 EMA 系数（弱权重，默认 0.15） */
  alphaWeak: number;
  /** history 保留条数上限（默认 50） */
  historyLimit: number;
  /** 价格带宽比：band = center·(1±ratio)，默认 0.2 */
  priceBandWidthRatio: number;
  /** 负反馈 EMA 系数（拒绝/口味纠偏时对命中考品类衰减），默认 0.3 */
  negativeBeta: number;
  /** 常点门店保留条数 */
  maxFrequentStores: number;
  /** 常点时段保留条数 */
  maxFrequentTimeSlots: number;
  /** 就餐时段判定所用 IANA 时区；缺省使用设备时区（如 `Asia/Shanghai`） */
  timeZone?: string;
  /** 画像持久化文件路径 */
  profileFilePath: string;
}

/** 默认配置（与设计 §4.2 关键参数表一致） */
export const DEFAULT_PROFILE_CONFIG: ProfileConfig = {
  alphaStrong: 0.4,
  alphaWeak: 0.15,
  historyLimit: 50,
  priceBandWidthRatio: 0.2,
  negativeBeta: 0.3,
  maxFrequentStores: 5,
  maxFrequentTimeSlots: 5,
  // 默认画像文件：锚定运行根目录的 data/（v1.3.0；见 src/core/paths.ts）。
  // 用 getter **惰性求值**，避免模块 import 时捕获环境导致与运行期不一致；可用 MCD_DATA_DIR/MCD_PROFILE_PATH 覆盖。
  get profileFilePath(): string {
    return resolveDataPath('profile.json');
  },
};

/** 读取 (0,1] 区间的环境变量，非法值回退默认（避免污染画像计算） */
function readAlphaEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    return fallback;
  }
  return value;
}

/** 读取正整数环境变量，非法值回退默认 */
function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    return fallback;
  }
  return value;
}

/** 解析画像文件路径（`MCD_PROFILE_PATH` 可覆盖；缺省锚定运行根目录 `data/profile.json`，v1.3.0） */
export function resolveProfileFilePath(): string {
  const raw = process.env.MCD_PROFILE_PATH?.trim();
  return raw && raw.length > 0 ? raw : resolveDataPath('profile.json');
}

/** 解析就餐时段判定时区（`MCD_PROFILE_TIMEZONE` 可覆盖；缺省返回 undefined → 由 deriveTimeSlot 取设备时区） */
export function resolveProfileTimeZone(): string | undefined {
  const raw = process.env.MCD_PROFILE_TIMEZONE?.trim();
  return raw && raw.length > 0 ? raw : undefined;
}

/**
 * 解析生效配置：环境变量覆盖默认值，`overrides` 优先级最高。
 */
export function resolveProfileConfig(overrides: Partial<ProfileConfig> = {}): ProfileConfig {
  return {
    alphaStrong: readAlphaEnv('MCD_PROFILE_ALPHA_STRONG', DEFAULT_PROFILE_CONFIG.alphaStrong),
    alphaWeak: readAlphaEnv('MCD_PROFILE_ALPHA_WEAK', DEFAULT_PROFILE_CONFIG.alphaWeak),
    historyLimit: readPositiveIntEnv('MCD_PROFILE_HISTORY_LIMIT', DEFAULT_PROFILE_CONFIG.historyLimit),
    priceBandWidthRatio: DEFAULT_PROFILE_CONFIG.priceBandWidthRatio,
    negativeBeta: readAlphaEnv('MCD_PROFILE_NEGATIVE_BETA', DEFAULT_PROFILE_CONFIG.negativeBeta),
    maxFrequentStores: DEFAULT_PROFILE_CONFIG.maxFrequentStores,
    maxFrequentTimeSlots: DEFAULT_PROFILE_CONFIG.maxFrequentTimeSlots,
    timeZone: resolveProfileTimeZone(),
    profileFilePath: resolveProfileFilePath(),
    ...overrides,
  };
}
