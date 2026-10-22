/**
 * 打分（技术设计 v1.1.0 §2.3、需求 US-7/US-9/US-12）：
 * `score = w1·品类匹配 + w2·价格带 + w3·营养契合 + w4·券后性价比 + w5·多样性 + w6·口味契合 + w7·门店热销`。
 * 每个维度以 0~1 归一后乘权重，加权分量写入 `candidate.breakdown`，实现可解释。
 * 权重取自 `config.ts`（温启动 `DEFAULT_...` / 冷启动 `COLD_START_WEIGHTS`）或 `scene.ts`（场景覆盖）。
 */

import { tasteFit } from './taste.js';

import type { RecommenderWeights } from './config.js';
import type { MealCandidate, NutritionGoal, NutritionInfo, PriceBand, UserProfile } from '../types/index.js';


function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

/** 价格带匹配：带内=1，带外按相对带宽衰减，未建立价格带=中性 0.5 */
export function priceBandFit(price: number, band: PriceBand): number {
  if (band.max <= 0 || band.max < band.min) {
    return 0.5;
  }
  if (price >= band.min && price <= band.max) {
    return 1;
  }
  const center = (band.min + band.max) / 2;
  if (center <= 0) {
    return 0;
  }
  const distance = price < band.min ? band.min - price : price - band.max;
  return clamp01(1 - distance / center);
}

/** 券后性价比：区间内越便宜越高（最便宜=1，最贵=0） */
export function valueFit(price: number, range: { min: number; max: number }): number {
  if (range.max <= range.min) {
    return 1;
  }
  return clamp01((range.max - price) / (range.max - range.min));
}

/** 营养契合：符合目标=1，按超限/缺口比例衰减；未知营养或未设目标=中性 0.5 */
export function nutritionFit(nutrition: NutritionInfo | undefined, goal: NutritionGoal | undefined): number {
  if (!goal) {
    return 0.5;
  }
  const parts: number[] = [];
  if (typeof goal.maxKcal === 'number' && goal.maxKcal > 0) {
    const kcal = nutrition?.energyKcal;
    parts.push(kcal === undefined ? 0.5 : kcal <= goal.maxKcal ? 1 : clamp01(1 - (kcal - goal.maxKcal) / goal.maxKcal));
  }
  if (typeof goal.minProtein === 'number' && goal.minProtein > 0) {
    const protein = nutrition?.protein;
    parts.push(
      protein === undefined ? 0.5 : protein >= goal.minProtein ? 1 : clamp01(protein / goal.minProtein),
    );
  }
  if (parts.length === 0) {
    return 0.5;
  }
  return parts.reduce((sum, value) => sum + value, 0) / parts.length;
}

/** 多样性（新颖度）：近期已选品类按次数降权（对应 US-9 / AC 6.2-5） */
export function noveltyFit(category: string | undefined, recentCategories: string[]): number {
  if (!category || recentCategories.length === 0) {
    return 1;
  }
  const count = recentCategories.filter((item) => item === category).length;
  return clamp01(1 - Math.min(0.8, 0.4 * count));
}

/** 热销契合：命中门店热销=1；未知=0.5；非热销=0 */
export function popularityFit(popularity: number | undefined): number {
  if (popularity === undefined) {
    return 0.5;
  }
  return clamp01(popularity);
}

/** 取画像近期选择中的品类（用于多样性降权） */
export function recentCategories(profile: UserProfile, window: number): string[] {
  return profile.history
    .slice(0, Math.max(window, 0))
    .map((record) => record.category)
    .filter((category): category is string => typeof category === 'string' && category.length > 0);
}

/** 候选券后价的极值（用于性价比归一） */
export function priceRangeOf(candidates: MealCandidate[]): { min: number; max: number } {
  if (candidates.length === 0) {
    return { min: 0, max: 0 };
  }
  const prices = candidates.map((candidate) => candidate.effectivePrice);
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

/** 打分输入 */
export interface ScoreInput {
  candidate: MealCandidate;
  profile: UserProfile;
  weights: RecommenderWeights;
  recentCategories: string[];
  priceRange: { min: number; max: number };
}

/** 计算单个候选得分与可解释分解 */
export function scoreCandidate(input: ScoreInput): { score: number; breakdown: Record<string, number> } {
  const { candidate, profile, weights, priceRange } = input;
  const categoryComp = candidate.category
    ? clamp01(profile.preferences.categoryWeights[candidate.category] ?? 0)
    : 0;
  const priceComp = priceBandFit(candidate.effectivePrice, profile.preferences.priceBand);
  const nutritionComp = nutritionFit(candidate.nutrition, profile.preferences.nutritionGoal);
  const valueComp = valueFit(candidate.effectivePrice, priceRange);
  const noveltyComp = noveltyFit(candidate.category, input.recentCategories);
  const tasteComp = tasteFit(candidate.tasteTags ?? [], profile.preferences.taste?.tags ?? []);
  const popularityComp = popularityFit(candidate.popularity);

  const breakdown: Record<string, number> = {
    category: round(weights.category * categoryComp),
    price: round(weights.price * priceComp),
    nutrition: round(weights.nutrition * nutritionComp),
    value: round(weights.value * valueComp),
    novelty: round(weights.novelty * noveltyComp),
    taste: round(weights.taste * tasteComp),
    popularity: round(weights.popularity * popularityComp),
  };
  const score = round(Object.values(breakdown).reduce((sum, value) => sum + value, 0));
  return { score, breakdown };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
