/**
 * 过滤（技术设计 v1.2.0 §2.3）：
 * - 剔除不可售（无有效价格）项；
 * - **饮食禁忌 / 过敏原**：硬过滤命中项；无可选时回退"命中最少"子集并置 `dietaryRelaxed=true`；
 * - `nutritionGoal.maxKcal` 超限项过滤；无满足项时回退"最接近项"并置 `nutritionRelaxed=true`。
 */

import { inferDietaryTags, matchesDietary } from './dietary.js';

import type { MealCandidate, UserProfile } from '../types/index.js';

/** 过滤结果 */
export interface FilterResult {
  candidates: MealCandidate[];
  /** 营养约束无满足项，已回退最接近项（上层需明确告知） */
  nutritionRelaxed: boolean;
  /** 饮食禁忌/过敏原无法完全满足，已回退命中最少项（上层需明确告警） */
  dietaryRelaxed: boolean;
}

function kcalOf(candidate: MealCandidate): number | undefined {
  return candidate.nutrition?.energyKcal;
}

/** 过滤候选 */
export function filterCandidates(candidates: MealCandidate[], profile: UserProfile): FilterResult {
  const available = candidates.filter((candidate) => candidate.price > 0);
  if (available.length === 0) {
    return { candidates: [], nutritionRelaxed: false, dietaryRelaxed: false };
  }

  // 饮食禁忌 / 过敏原（近似关键词过滤）
  const restricted = [
    ...(profile.preferences.dietary?.allergies ?? []),
    ...(profile.preferences.dietary?.avoid ?? []),
  ];
  let pool = available;
  let dietaryRelaxed = false;
  if (restricted.length > 0) {
    const clean = available.filter((candidate) => !matchesDietary(candidate.name, candidate.category, restricted));
    if (clean.length > 0) {
      pool = clean;
    } else {
      // 无法完全满足：回退到"命中受限标签最少"的子集，并由上层明确告警（绝不静默）
      const matchCount = (candidate: MealCandidate): number =>
        inferDietaryTags(candidate.name, candidate.category).filter((tag) => restricted.includes(tag)).length;
      const min = Math.min(...available.map(matchCount));
      pool = available.filter((candidate) => matchCount(candidate) === min);
      dietaryRelaxed = true;
    }
  }

  // 营养（热量上限）
  const maxKcal = profile.preferences.nutritionGoal?.maxKcal;
  if (typeof maxKcal !== 'number' || !Number.isFinite(maxKcal)) {
    return { candidates: pool, nutritionRelaxed: false, dietaryRelaxed };
  }

  // 未知热量视作不超限（仅剔除明确超限项）
  const within = pool.filter((candidate) => {
    const kcal = kcalOf(candidate);
    return kcal === undefined || kcal <= maxKcal;
  });
  if (within.length > 0) {
    return { candidates: within, nutritionRelaxed: false, dietaryRelaxed };
  }

  const closest = [...pool].sort((a, b) => (kcalOf(a) ?? Infinity) - (kcalOf(b) ?? Infinity));
  return { candidates: closest, nutritionRelaxed: true, dietaryRelaxed };
}
