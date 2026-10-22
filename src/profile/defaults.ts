/**
 * 默认空画像（技术设计 §2.2「损坏恢复」）：文件缺失、解析失败或首次运行时使用。
 */

import type { UserProfile } from '../types/index.js';

/** 当前画像结构版本（结构变更时递增，便于后续迁移；v2 新增 location/taste） */
export const PROFILE_VERSION = 2;

/**
 * 创建默认空画像。
 *
 * 约定：`priceBand` 的 `{min:0,max:0}` 表示价格带尚未建立（`max<=0` 视为未设定），
 * 由 `updatePriceBand` 在首次记录选择时初始化。
 * `location` / `preferences.taste` 为可选字段，空画像下不下发（由采集或选择逐步补齐）。
 */
export function createDefaultProfile(): UserProfile {
  return {
    version: PROFILE_VERSION,
    preferences: {
      categoryWeights: {},
      priceBand: { min: 0, max: 0 },
    },
    frequent: { storeCodes: [], timeSlots: [] },
    history: [],
    updatedAt: new Date().toISOString(),
  };
}
