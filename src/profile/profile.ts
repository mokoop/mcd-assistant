/**
 * 用户偏好画像主逻辑（技术设计 §4.3）。
 *
 * 对外能力：读取 / 保存 / 记录选择（EMA）/ 构建起始画像 / 脱敏摘要。
 * 记录选择与起始画像走「读改写」原子路径，保证并发下不丢更新、不损坏文件。
 */

import { logger, mask } from '../core/logger.js';

import { DEFAULT_PROFILE_CONFIG, resolveProfileConfig, resolveProfileFilePath } from './config.js';
import { createDefaultProfile } from './defaults.js';
import {
  applyNegativeSignal,
  deriveTimeSlot,
  mergeTags,
  updateCategoryWeights,
  updateMealTypePreference,
  updatePriceBand,
} from './ema.js';
import { createProfileStore } from './store.js';

import type { ProfileConfig } from './config.js';
import type { ProfileStore } from './store.js';
import type {
  ChoiceRecord,
  DietaryPreference,
  DiningChannel,
  MealCandidate,
  MealType,
  NutritionGoal,
  PriceBand,
  TastePreference,
  UserLocation,
  UserProfile,
} from '../types/index.js';

/** 摘要中展示的偏好品类条数上限 */
const TOP_CATEGORY_LIMIT = 3;

/** 脱敏可读画像摘要（对应需求 AC 6.3-4） */
export interface ProfileSummary {
  /** 画像最后更新时间（ISO8601） */
  updatedAt: string;
  /** 累计选择记录条数（受 history 上限约束） */
  totalChoices: number;
  /** 偏好品类（按权重降序，最多 3 项） */
  topCategories: Array<{ category: string; weight: number }>;
  /** 价格带 */
  priceBand: PriceBand;
  /** 营养目标（若有） */
  nutritionGoal?: NutritionGoal;
  /** 常点门店（**已脱敏**） */
  frequentStores: string[];
  /** 常点时段 */
  frequentTimeSlots: string[];
  /** 餐次偏好（若有） */
  mealTypePreference?: Record<MealType, number>;
  /** 位置 / 取餐方式（若有，v1.1.0） */
  location?: UserLocation;
  /** 口味偏好（若有，v1.1.0） */
  taste?: TastePreference;
  /** 饮食禁忌 / 过敏原（若有，v1.2.0） */
  dietary?: DietaryPreference;
  /** 可读摘要文本 */
  text: string;
}

/**
 * 判定冷启动画像（v1.1.0 §2.3）：以**行为证据**为准 —— 无品类权重 且 无历史记录。
 *
 * 注意：**不**以"价格带是否建立"为条件。用户经 onboarding 声明预算会写入价格带，
 * 那只是"声明"而非"学习到的行为"，不应关闭冷启动（否则冷启动默认人格/热销权重形同虚设）。
 */
export function isColdStart(profile: UserProfile): boolean {
  return Object.keys(profile.preferences.categoryWeights).length === 0 && profile.history.length === 0;
}

let defaultStore: ProfileStore | undefined;

/** 获取默认 store（路径经 `resolveProfileFilePath()` 解析，惰性创建以支持测试注入环境变量） */
function getDefaultStore(): ProfileStore {
  defaultStore ??= createProfileStore(resolveProfileFilePath());
  return defaultStore;
}

function pushRecent(list: string[], value: string, limit: number): string[] {
  return [value, ...list.filter((item) => item !== value)].slice(0, Math.max(limit, 1));
}

/**
 * 将一条选择记录应用到画像（**纯函数**，不涉及 IO，不刷新 `updatedAt`）。
 *
 * - 明确选择用 `α_strong`、未明确选择/采纳推荐用 `α_weak`；
 * - 更新品类权重（归一化）、价格带（滑动）、餐次偏好、常点门店/时段；
 * - 就餐时段按 `config.timeZone`（缺省设备时区）换算本地时间后归类；
 * - `history` 保留最近 N 条（N 默认 50，最新在前）。
 */
export function applyChoice(
  profile: UserProfile,
  record: ChoiceRecord,
  config: ProfileConfig = DEFAULT_PROFILE_CONFIG,
): UserProfile {
  const alpha = record.source === 'explicit' ? config.alphaStrong : config.alphaWeak;

  const categoryWeights = record.category
    ? updateCategoryWeights(profile.preferences.categoryWeights, record.category, alpha)
    : profile.preferences.categoryWeights;

  const priceBand = updatePriceBand(
    profile.preferences.priceBand,
    record.effectivePrice,
    alpha,
    config.priceBandWidthRatio,
  );

  const slot = deriveTimeSlot(record.timestamp, config.timeZone);
  const mealTypePreference =
    slot === 'lunch' || slot === 'dinner'
      ? updateMealTypePreference(profile.preferences.mealTypePreference, slot, alpha)
      : profile.preferences.mealTypePreference;

  const storeCodes = record.storeCode
    ? pushRecent(profile.frequent.storeCodes, record.storeCode, config.maxFrequentStores)
    : profile.frequent.storeCodes;
  const timeSlots = slot
    ? pushRecent(profile.frequent.timeSlots, slot, config.maxFrequentTimeSlots)
    : profile.frequent.timeSlots;

  const history = [record, ...profile.history].slice(0, Math.max(config.historyLimit, 1));

  return {
    ...profile,
    preferences: {
      ...profile.preferences,
      categoryWeights,
      priceBand,
      ...(mealTypePreference ? { mealTypePreference } : {}),
    },
    frequent: { storeCodes, timeSlots },
    history,
  };
}

/** 读取用户画像；文件缺失/损坏时回退默认空画像（不抛错） */
export async function readProfile(store: ProfileStore = getDefaultStore()): Promise<UserProfile> {
  return store.read();
}

/** 保存画像（刷新 `updatedAt`，原子写），返回落盘后的画像 */
export async function saveProfile(
  profile: UserProfile,
  store: ProfileStore = getDefaultStore(),
): Promise<UserProfile> {
  const next: UserProfile = { ...profile, updatedAt: new Date().toISOString() };
  await store.write(next);
  return next;
}

/**
 * 记录一次选择并更新画像（EMA），返回更新后的画像。
 *
 * `record.source` 决定权重：`explicit` 强、`recommended` 弱。
 */
export async function recordChoice(
  record: ChoiceRecord,
  store: ProfileStore = getDefaultStore(),
  config: ProfileConfig = resolveProfileConfig(),
): Promise<UserProfile> {
  const updated = await store.update((current) => applyChoice(current, record, config));
  logger.info('已更新用户偏好画像', {
    source: record.source,
    category: record.category,
    hasStoreCode: record.storeCode.length > 0,
    historySize: updated.history.length,
  });
  return updated;
}

/**
 * 构建起始画像：用户**未明确选择**时，以推荐结果（`primary`）作为起始画像。
 *
 * 以 `source='recommended'` 走弱权重（`α_weak`）更新，符合需求 US-4 / AC 6.3-2。
 * `MealCandidate` 不含门店信息，故 `storeCode` 可选传入（缺省不更新常点门店）。
 */
export async function buildStartingProfile(
  primary: MealCandidate,
  store: ProfileStore = getDefaultStore(),
  storeCode = '',
  config: ProfileConfig = resolveProfileConfig(),
): Promise<UserProfile> {
  const record: ChoiceRecord = {
    timestamp: new Date().toISOString(),
    storeCode,
    mealCode: primary.code,
    mealName: primary.name,
    effectivePrice: primary.effectivePrice,
    ...(primary.category ? { category: primary.category } : {}),
    source: 'recommended',
  };
  return recordChoice(record, store, config);
}

/** 可清除的画像维度（v1.2.0） */
export type ProfileClear = 'location' | 'taste' | 'budget' | 'nutrition' | 'dietary';

/**
 * 画像变更补丁（v1.1.0 起；v1.2.0 增 `dietary` 与 `clear`）。
 *
 * - `location`：浅合并；`clear` 含 `'location'` 时删除；
 * - `taste` / `dietary`：按 `mergeTags` 追加 / 移除（去重）；
 * - `priceBand` / `nutritionGoal`：覆盖；`clear` 含 `'budget'`→`{0,0}`、含 `'nutrition'`→删除；
 * - `mealType`：以弱权重更新餐次偏好；
 * - `clear` 含 `'taste'` / `'dietary'`：删除对应维度。
 */
export interface ProfilePatch {
  location?: UserLocation;
  taste?: { tags?: string[]; removeTags?: string[]; spicyLevel?: number };
  dietary?: { avoid?: string[]; allergies?: string[]; removeAvoid?: string[]; removeAllergies?: string[] };
  priceBand?: PriceBand;
  nutritionGoal?: NutritionGoal;
  mealType?: MealType;
  /** 需清除的维度（v1.2.0） */
  clear?: ProfileClear[];
}

/** 应用画像补丁（**纯函数**，不涉及 IO，不刷新 `updatedAt`） */
export function applyProfilePatch(
  profile: UserProfile,
  patch: ProfilePatch,
  config: ProfileConfig = DEFAULT_PROFILE_CONFIG,
): UserProfile {
  const clears = new Set<ProfileClear>(patch.clear ?? []);

  // location：合并 / 清除
  let location = patch.location ? { ...profile.location, ...patch.location } : profile.location;
  if (clears.has('location')) {
    location = undefined;
  }

  // taste：清除 → 合并
  let taste = clears.has('taste') ? undefined : profile.preferences.taste;
  if (patch.taste) {
    const base: TastePreference = taste ?? { tags: [] };
    const tags = mergeTags(base.tags, patch.taste.tags ?? [], patch.taste.removeTags ?? []);
    const spicyLevel = patch.taste.spicyLevel ?? base.spicyLevel;
    taste = { tags, ...(typeof spicyLevel === 'number' ? { spicyLevel } : {}) };
  }

  // dietary：清除 → 合并；两者皆空则不下发
  let dietary = clears.has('dietary') ? undefined : profile.preferences.dietary;
  if (patch.dietary) {
    const base: DietaryPreference = dietary ?? { avoid: [], allergies: [] };
    const avoid = mergeTags(base.avoid, patch.dietary.avoid ?? [], patch.dietary.removeAvoid ?? []);
    const allergies = mergeTags(base.allergies, patch.dietary.allergies ?? [], patch.dietary.removeAllergies ?? []);
    dietary = avoid.length > 0 || allergies.length > 0 ? { avoid, allergies } : undefined;
  }

  const priceBand: PriceBand = clears.has('budget')
    ? { min: 0, max: 0 }
    : patch.priceBand ?? profile.preferences.priceBand;
  const nutritionGoal = clears.has('nutrition')
    ? undefined
    : patch.nutritionGoal ?? profile.preferences.nutritionGoal;

  const mealTypePreference = patch.mealType
    ? updateMealTypePreference(profile.preferences.mealTypePreference, patch.mealType, config.alphaWeak)
    : profile.preferences.mealTypePreference;

  const preferences = { ...profile.preferences, priceBand };
  if (taste) preferences.taste = taste;
  else delete preferences.taste;
  if (dietary) preferences.dietary = dietary;
  else delete preferences.dietary;
  if (nutritionGoal) preferences.nutritionGoal = nutritionGoal;
  else delete preferences.nutritionGoal;
  if (mealTypePreference) preferences.mealTypePreference = mealTypePreference;

  const next: UserProfile = { ...profile, preferences };
  if (location) next.location = location;
  else delete next.location;
  return next;
}

/**
 * 应用采集/纠偏补丁并原子落盘，返回更新后的画像（对应设计 §2.4 / §2.5）。
 */
export async function configureProfile(
  patch: ProfilePatch,
  store: ProfileStore = getDefaultStore(),
  config: ProfileConfig = resolveProfileConfig(),
): Promise<UserProfile> {
  const updated = await store.update((current) => applyProfilePatch(current, patch, config));
  logger.info('已更新画像配置', {
    hasLocation: Boolean(patch.location),
    tasteAdded: patch.taste?.tags?.length ?? 0,
    tasteRemoved: patch.taste?.removeTags?.length ?? 0,
    hasBudget: Boolean(patch.priceBand),
  });
  return updated;
}

/**
 * 重置画像为默认空画像（v1.2.0）——破坏性操作，须由上层在用户显式确认后调用。
 *
 * 采用原子写覆盖为默认画像（而非删除文件），保证并发下读取方始终看到合法画像。
 */
export async function resetProfile(
  store: ProfileStore = getDefaultStore(),
  config: ProfileConfig = resolveProfileConfig(),
): Promise<UserProfile> {
  void config;
  const fresh = createDefaultProfile();
  await store.write(fresh);
  logger.info('已重置用户画像');
  return fresh;
}

/**
 * 记录一次**负反馈**（拒绝某品类 / 口味纠偏展开后的品类），对品类权重做 EMA 衰减（对应设计 §2.5）。
 *
 * 非法或未知品类时保持画像不变（不产生非法权重）。
 */
export async function recordNegativeSignal(
  category: string,
  store: ProfileStore = getDefaultStore(),
  config: ProfileConfig = resolveProfileConfig(),
): Promise<UserProfile> {
  if (category.trim().length === 0) {
    return readProfile(store);
  }
  const updated = await store.update((current) => ({
    ...current,
    preferences: {
      ...current.preferences,
      categoryWeights: applyNegativeSignal(current.preferences.categoryWeights, category, config.negativeBeta),
    },
  }));
  logger.info('已记录负反馈', { hasCategory: category.length > 0 });
  return updated;
}

/** 取餐方式中文标签 */
function channelLabel(channel: DiningChannel | undefined): string {
  if (channel === 'delivery') {
    return '麦乐送';
  }
  if (channel === 'nearby') {
    return '到店';
  }
  return '';
}

/**
 * 摘要用：位置脱敏（仅保留城市 / 取餐方式；门店码掩码；**不暴露配送地址 ID**）。
 * 与 `frequentStores` 的掩码口径一致，避免把地址 ID 透出给宿主（设计 §2.8）。
 */
function sanitizeLocation(location: UserLocation | undefined): UserLocation | undefined {
  if (!location) {
    return undefined;
  }
  const sanitized: UserLocation = {};
  if (location.city) sanitized.city = location.city;
  if (location.channel) sanitized.channel = location.channel;
  if (location.defaultStoreCode) sanitized.defaultStoreCode = mask(location.defaultStoreCode, 4);
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function renderSummaryText(summary: ProfileSummary): string {
  const hasTaste = Boolean(summary.taste && summary.taste.tags.length > 0);
  const hasLocation = Boolean(summary.location && (summary.location.city || summary.location.channel));
  const hasDietary = Boolean(
    summary.dietary && (summary.dietary.avoid.length > 0 || summary.dietary.allergies.length > 0),
  );
  if (summary.totalChoices === 0 && !hasTaste && !hasLocation && !hasDietary) {
    return '暂无偏好记录，推荐将使用默认设定。';
  }
  const categories =
    summary.topCategories.length > 0
      ? summary.topCategories.map((item) => `${item.category}(${item.weight.toFixed(2)})`).join('、')
      : '暂无';
  const priceRange =
    summary.priceBand.max > 0
      ? `¥${summary.priceBand.min.toFixed(2)}–¥${summary.priceBand.max.toFixed(2)}`
      : '未建立';
  const parts = [
    `共记录 ${summary.totalChoices} 次选择`,
    `偏好品类：${categories}`,
    `价格带：${priceRange}`,
  ];
  if (summary.location) {
    const place = [summary.location.city, channelLabel(summary.location.channel)].filter(
      (item): item is string => typeof item === 'string' && item.length > 0,
    );
    if (place.length > 0) {
      parts.push(`位置/取餐：${place.join('·')}`);
    }
  }
  if (summary.taste && summary.taste.tags.length > 0) {
    parts.push(`口味偏好：${summary.taste.tags.join('、')}`);
  }
  if (summary.dietary) {
    const dietaryParts: string[] = [];
    if (summary.dietary.allergies.length > 0) {
      dietaryParts.push(`过敏原：${summary.dietary.allergies.join('、')}`);
    }
    if (summary.dietary.avoid.length > 0) {
      dietaryParts.push(`忌口：${summary.dietary.avoid.join('、')}`);
    }
    if (dietaryParts.length > 0) {
      parts.push(dietaryParts.join('；'));
    }
  }
  if (summary.frequentTimeSlots.length > 0) {
    parts.push(`常点时段：${summary.frequentTimeSlots.join('、')}`);
  }
  if (summary.nutritionGoal) {
    const goal = summary.nutritionGoal;
    const goalText = [
      typeof goal.maxKcal === 'number' ? `热量上限 ${goal.maxKcal}kcal` : null,
      typeof goal.minProtein === 'number' ? `蛋白质下限 ${goal.minProtein}g` : null,
    ]
      .filter((item): item is string => item !== null)
      .join('、');
    if (goalText.length > 0) {
      parts.push(`营养目标：${goalText}`);
    }
  }
  return `${parts.join('；')}。`;
}

/**
 * 生成**脱敏**可读画像摘要（需求 AC 6.3-4）。
 *
 * 门店编码以掩码呈现；画像本身不含姓名/手机号/完整地址等个人信息。
 */
export async function getProfileSummary(store: ProfileStore = getDefaultStore()): Promise<ProfileSummary> {
  const profile = await store.read();
  const topCategories = Object.entries(profile.preferences.categoryWeights)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_CATEGORY_LIMIT)
    .map(([category, weight]) => ({ category, weight: Math.round(weight * 1000) / 1000 }));
  const summary: ProfileSummary = {
    updatedAt: profile.updatedAt,
    totalChoices: profile.history.length,
    topCategories,
    priceBand: profile.preferences.priceBand,
    ...(profile.preferences.nutritionGoal ? { nutritionGoal: profile.preferences.nutritionGoal } : {}),
    frequentStores: profile.frequent.storeCodes.map((code) => mask(code, 4)),
    frequentTimeSlots: profile.frequent.timeSlots,
    ...(profile.preferences.mealTypePreference
      ? { mealTypePreference: profile.preferences.mealTypePreference }
      : {}),
    ...(profile.preferences.taste ? { taste: profile.preferences.taste } : {}),
    ...(profile.preferences.dietary ? { dietary: profile.preferences.dietary } : {}),
    ...(sanitizeLocation(profile.location) ? { location: sanitizeLocation(profile.location) } : {}),
    text: '',
  };
  summary.text = renderSummaryText(summary);
  return summary;
}
