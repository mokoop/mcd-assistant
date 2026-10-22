/**
 * 画像持久化结构校验（zod）。
 *
 * 作用：读取时校验损坏/篡改文件并剔除未知字段，保证**只有画像字段**会落入本地文件，
 * 从结构上避免姓名/手机号/完整地址等个人信息被持久化（需求 §7 安全与隐私）。
 */

import { z } from 'zod';

import { PROFILE_VERSION } from './defaults.js';

import type { UserProfile } from '../types/index.js';

const choiceRecordSchema = z.object({
  timestamp: z.string(),
  storeCode: z.string(),
  mealCode: z.string(),
  mealName: z.string(),
  effectivePrice: z.number(),
  category: z.string().optional(),
  source: z.enum(['explicit', 'recommended', 'rejected']),
});

const priceBandSchema = z.object({
  min: z.number(),
  max: z.number(),
});

const nutritionGoalSchema = z.object({
  maxKcal: z.number().optional(),
  minProtein: z.number().optional(),
});

const mealTypePreferenceSchema = z.object({
  lunch: z.number(),
  dinner: z.number(),
});

/** 口味偏好（v1.1.0）：仅标签与可选辣度，未知字段被剥离 */
const tastePreferenceSchema = z.object({
  tags: z.array(z.string()),
  spicyLevel: z.number().optional(),
});

/** 饮食禁忌 / 过敏原（v1.2.0）：仅标签，未知字段被剥离 */
const dietaryPreferenceSchema = z.object({
  avoid: z.array(z.string()),
  allergies: z.array(z.string()),
});

const userPreferencesSchema = z.object({
  categoryWeights: z.record(z.string(), z.number()),
  priceBand: priceBandSchema,
  nutritionGoal: nutritionGoalSchema.optional(),
  mealTypePreference: mealTypePreferenceSchema.optional(),
  taste: tastePreferenceSchema.optional(),
  dietary: dietaryPreferenceSchema.optional(),
});

/** 位置 / 取餐方式（v1.1.0）：仅存城市名 / 门店码 / 地址 ID，不含完整地址与联系人 */
const userLocationSchema = z.object({
  city: z.string().optional(),
  defaultStoreCode: z.string().optional(),
  defaultAddressId: z.string().optional(),
  channel: z.enum(['delivery', 'nearby']).optional(),
});

const userProfileSchema = z.object({
  version: z.number().optional(),
  preferences: userPreferencesSchema,
  location: userLocationSchema.optional(),
  frequent: z.object({
    storeCodes: z.array(z.string()),
    timeSlots: z.array(z.string()),
  }),
  history: z.array(choiceRecordSchema),
  updatedAt: z.string(),
});

/**
 * 校验并归一化画像对象；未知字段被剥离，类型不符时抛出 `ZodError`（由上层回退默认画像）。
 *
 * v1 → v2 迁移：v1 无 `location` / `taste` 字段，二者均为可选，故读取后仅需将 `version` 提升为 2，
 * 不丢历史与既有偏好；结构由 `createDefaultProfile` 生成的画像直接为 v2。
 */
export function parseUserProfile(input: unknown): UserProfile {
  const parsed = userProfileSchema.parse(input);
  return { ...parsed, version: Math.max(parsed.version ?? PROFILE_VERSION, PROFILE_VERSION) };
}
