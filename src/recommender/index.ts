/**
 * recommender 模块对外出口与编排（技术设计 §4.1 时序 / §4.2 六步）。
 *
 * 流程：门店/地址策略 → 候选生成 → 营养匹配 → 过滤 → 打分 → 券后试算 → 组装。
 */

import { AppError, ErrorCode } from '../core/errors.js';
import { logger } from '../core/logger.js';
import { isColdStart } from '../profile/index.js';

import { assembleRecommendation } from './assemble.js';
import { suggestBundle } from './bundle.js';
import { buildCandidates } from './candidates.js';
import { COLD_START_WEIGHTS, resolveRecommenderConfig } from './config.js';
import { applyCouponPricing } from './coupons.js';
import { defaultRecommendDeps } from './deps.js';
import { filterCandidates } from './filter.js';
import { attachNutrition } from './nutrition.js';
import { resolveScene, sceneWeights, type EffectiveScene } from './scene.js';
import { priceRangeOf, recentCategories, scoreCandidate } from './score.js';
import { channelOrderParams, resolveChannel } from './store-strategy.js';

import type { RecommenderConfig, RecommenderWeights } from './config.js';
import type { RecommendDeps } from './deps.js';
import type { Channel } from './store-strategy.js';
import type { NearbyStoresQuery, StoreMenuQuery } from '../mcp-client/types.js';
import type { DeliveryAddress, MealCandidate, MealType, Recommendation, Scene, StoreInfo, UserProfile } from '../types/index.js';

/** 推荐入参 */
export interface RecommendOptions {
  /** 显式渠道（首次询问并记忆由 index 负责） */
  channel?: Channel;
  /** 配送地址（麦乐送） */
  addressId?: string;
  /** 附近门店检索条件（到店） */
  city?: string;
  keyword?: string;
  /** 直接指定门店（跳过门店检索） */
  storeCode?: string;
  beCode?: string;
  /**
   * 餐次（保留字段，评审 R6）：当前不参与过滤——候选可售性由 `query-meals` 的当前时段返回体现
   * （设计 §4.2 步骤 1）；保留供宿主/上层透传展示与后续按时段扩展。
   */
  mealType?: MealType;
  timezone?: string;
  now?: Date;
  /** 推荐场景（v1.1.0，默认 auto：按时间自动判定） */
  scene?: Scene;
  /** 需排除的候选 code（v1.1.0，"换一换"） */
  excludeCodes?: string[];
  /** 注入画像（缺省读取持久化画像） */
  profile?: UserProfile;
  /** 覆盖推荐参数（weights 支持部分覆盖） */
  config?: Partial<Omit<RecommenderConfig, 'weights'>> & { weights?: Partial<RecommenderWeights> };
}

/** 推荐结果 */
export interface RecommendResult {
  recommendation: Recommendation;
  channel: Channel;
  store: StoreInfo;
  /** 营养约束无满足项，已回退最接近项 */
  nutritionRelaxed: boolean;
  /** 饮食禁忌/过敏原无法完全满足，已回退命中最少项（v1.2.0） */
  dietaryRelaxed: boolean;
  /** 实际生效场景（undefined 表示用基准/冷启动权重） */
  scene?: EffectiveScene;
  /** 是否冷启动推荐 */
  coldStart: boolean;
  /** 供上层展示的提示（含"仅供参考"） */
  notices: string[];
}

/**
 * 生成套餐推荐。
 */
export async function recommend(
  options: RecommendOptions = {},
  deps: RecommendDeps = defaultRecommendDeps,
): Promise<RecommendResult> {
  const config = resolveRecommenderConfig(options.config);
  const profile = options.profile ?? (await deps.readProfile());
  let degraded = false;

  // 冷启动判定 + 场景/权重选择（v1.1.0 §2.3）：场景权重 > 冷启动权重 > 温启动权重
  const coldStart = isColdStart(profile);
  const now = options.now ?? new Date();
  const effectiveScene = resolveScene(options.scene ?? 'auto', now, options.timezone);
  const weights = sceneWeights(effectiveScene) ?? (coldStart ? COLD_START_WEIGHTS : config.weights);

  // 位置/取餐方式：显式入参优先，缺省回退画像 `location`（v1.1.0 闭环：采集的位置要真正生效）
  const loc = profile.location;
  const reqChannel = options.channel ?? loc?.channel;
  const reqAddressId = options.addressId ?? loc?.defaultAddressId;
  const reqStoreCode = options.storeCode ?? loc?.defaultStoreCode;
  const reqCity = options.city ?? loc?.city;

  // ① 门店/地址策略
  let addressId = reqAddressId;
  let addresses: DeliveryAddress[] = [];
  const needAddresses = reqChannel === undefined || (reqChannel === 'delivery' && !addressId);
  if (!reqStoreCode && needAddresses) {
    const result = await deps.deliveryQueryAddresses();
    degraded ||= result.degraded;
    addresses = result.data;
  }
  let channel: Channel = reqChannel ?? resolveChannel({ addressId, hasAddresses: addresses.length > 0 });
  if (channel === 'delivery' && !addressId) {
    addressId = addresses[0]?.addressId;
    if (!addressId) {
      channel = 'nearby';
    }
  }

  let store: StoreInfo | undefined;
  if (reqStoreCode) {
    store = { storeCode: reqStoreCode, ...(options.beCode ? { beCode: options.beCode } : {}) };
  } else if (channel === 'delivery') {
    const result = await deps.deliveryQueryStores({ addressId: addressId ?? '', beType: 2 });
    degraded ||= result.degraded;
    store = result.data[0];
  } else {
    const query: NearbyStoresQuery = {
      searchType: 1,
      beType: 1,
      ...(reqCity ? { city: reqCity } : {}),
      ...(options.keyword ? { keyword: options.keyword } : {}),
    };
    const result = await deps.queryNearbyStores(query);
    degraded ||= result.degraded;
    store = result.data[0];
  }
  if (!store) {
    throw new AppError({ code: ErrorCode.EMPTY_RESULT, message: '未找到可用门店' });
  }

  // ② 候选生成
  const { orderType, beType } = channelOrderParams(channel);
  const menuQuery: StoreMenuQuery = {
    storeCode: store.storeCode,
    beCode: store.beCode ?? (channel === 'delivery' ? '2' : '1'),
    orderType,
    beType,
  };
  const { candidates, degraded: candidatesDegraded } = await buildCandidates(deps, menuQuery);
  degraded ||= candidatesDegraded;

  // ③ 营养匹配（TOON）
  let nutritionComplete = false;
  try {
    const nutrition = await deps.listNutritionFoods();
    degraded ||= nutrition.degraded;
    nutritionComplete = attachNutrition(candidates, nutrition.data).matchedAll;
  } catch (error) {
    logger.warn('营养数据获取失败，已跳过营养匹配', { error: String(error) });
  }

  // ④ 过滤（营养约束 + 饮食禁忌/过敏原）+ 排除项（"换一换"）
  const {
    candidates: withinNutrition,
    nutritionRelaxed,
    dietaryRelaxed,
  } = filterCandidates(candidates, profile);
  const excluded = new Set(options.excludeCodes ?? []);
  const filtered =
    excluded.size > 0 ? withinNutrition.filter((candidate) => !excluded.has(candidate.code)) : withinNutrition;
  if (filtered.length === 0) {
    throw new AppError({ code: ErrorCode.EMPTY_RESULT, message: '当前无可售套餐' });
  }

  // ⑤ 打分（初评：券后价=原价）→ Top-K
  const recent = recentCategories(profile, config.recentHistoryWindow);
  const prelimRange = priceRangeOf(filtered);
  applyScores(filtered, profile, weights, recent, prelimRange);
  const topCandidates = [...filtered].sort((a, b) => b.score - a.score).slice(0, config.topK);

  // ⑥ 券后试算（≤ M 次）→ 终评
  const pricing = await applyCouponPricing({ deps, store, channel, topCandidates, config });
  degraded ||= pricing.degraded;

  // 终评与组装**仅基于已完成券后试算的 Top-K**（评审 R3）：
  // 避免"初评不在 Top-K、未计券后价"的候选被全量重排后成为 primary（其 effectivePrice 仍为原价）。
  applyScores(topCandidates, profile, weights, recent, priceRangeOf(topCandidates));

  const { recommendation, notices } = assembleRecommendation({
    candidates: topCandidates,
    profile,
    nutritionRelaxed,
    nutritionComplete,
    dietaryRelaxed,
    degraded,
    coldStart,
    ...(effectiveScene ? { scene: effectiveScene } : {}),
    ...(options.timezone ? { timezone: options.timezone } : {}),
    now,
  });

  // ⑦ 凑单建议（v1.2.0）：基于满减券门槛 + 其余可售候选，**不发起**额外 MCP 调用
  const bundle = suggestBundle({
    primary: recommendation.primary,
    candidates: filtered,
    coupons: pricing.coupons,
    ...(pricing.appliedCoupon ? { excludeCoupon: pricing.appliedCoupon } : {}),
    config,
  });
  if (bundle) {
    recommendation.bundle = bundle;
  }

  return {
    recommendation,
    channel,
    store,
    nutritionRelaxed,
    dietaryRelaxed,
    ...(effectiveScene ? { scene: effectiveScene } : {}),
    coldStart,
    notices,
  };
}

function applyScores(
  candidates: MealCandidate[],
  profile: UserProfile,
  weights: RecommenderWeights,
  recent: string[],
  priceRange: { min: number; max: number },
): void {
  for (const candidate of candidates) {
    const scored = scoreCandidate({ candidate, profile, weights, recentCategories: recent, priceRange });
    candidate.score = scored.score;
    candidate.breakdown = scored.breakdown;
  }
}

export { COLD_START_WEIGHTS, DEFAULT_RECOMMENDER_CONFIG, resolveRecommenderConfig } from './config.js';
export type { RecommenderConfig, RecommenderWeights } from './config.js';
export { defaultRecommendDeps } from './deps.js';
export type { RecommendDeps } from './deps.js';
export { resolveChannel, channelOrderParams } from './store-strategy.js';
export type { Channel } from './store-strategy.js';
export {
  SCENE_LABELS,
  SCENE_VALUES,
  SCENE_WEIGHTS,
  isLateNight,
  isScene,
  localHour,
  resolveScene,
  sceneLabel,
  sceneWeights,
} from './scene.js';
export type { EffectiveScene } from './scene.js';
export { TASTE_RULES, categoriesForTasteTag, inferTasteTags, tasteFit } from './taste.js';
export type { TasteRule } from './taste.js';
export { DIETARY_OPTIONS, DIETARY_RULES, inferDietaryTags, matchesDietary } from './dietary.js';
export type { DietaryRule } from './dietary.js';
export { parseThresholdCoupon, suggestBundle } from './bundle.js';
export type { ThresholdCoupon } from './bundle.js';
export { buildCandidates, toCandidate } from './candidates.js';
export { filterCandidates } from './filter.js';
export { attachNutrition, buildNutritionIndex, findNutrition } from './nutrition.js';
export {
  noveltyFit,
  nutritionFit,
  popularityFit,
  priceBandFit,
  priceRangeOf,
  recentCategories,
  scoreCandidate,
  valueFit,
} from './score.js';
export { applyCouponPricing, dedupeCoupons, pickBestCoupon, couponValue } from './coupons.js';
export { assembleRecommendation, buildReasons } from './assemble.js';
