/**
 * 营养匹配（技术设计 §4.2 步骤 3/4、§3.2 TOON 解析、§5 营养缺失处理）。
 * `list-nutrition-foods`（TOON 解析后的）按 productName 与候选名称匹配；缺失则不展示热量。
 */

import type { MealCandidate, NutritionFood, NutritionInfo } from '../types/index.js';

/** 归一化名称：去空白与常见后缀差异，便于名称匹配 */
function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '');
}

/** 构建名称 → 营养 索引（重名后者覆盖前者） */
export function buildNutritionIndex(foods: NutritionFood[]): Map<string, NutritionInfo> {
  const index = new Map<string, NutritionInfo>();
  for (const food of foods) {
    if (food.productName.trim().length === 0) {
      continue;
    }
    index.set(normalizeName(food.productName), food.nutrition);
  }
  return index;
}

/** 按名称精确匹配，其次包含匹配（候选名包含营养名或反之） */
export function findNutrition(index: Map<string, NutritionInfo>, name: string): NutritionInfo | undefined {
  const key = normalizeName(name);
  const exact = index.get(key);
  if (exact) {
    return exact;
  }
  for (const [foodName, nutrition] of index) {
    if (foodName.length > 0 && (key.includes(foodName) || foodName.includes(key))) {
      return nutrition;
    }
  }
  return undefined;
}

/**
 * 为候补充营养信息。
 * @returns `matchedAll=true` 表示所有候选都匹配到营养（否则需在理由中标注"数据仅供参考"）。
 */
export function attachNutrition(
  candidates: MealCandidate[],
  foods: NutritionFood[],
): { matchedAll: boolean } {
  const index = buildNutritionIndex(foods);
  let matchedAll = candidates.length > 0;
  for (const candidate of candidates) {
    const nutrition = findNutrition(index, candidate.name);
    if (nutrition) {
      candidate.nutrition = nutrition;
    } else {
      matchedAll = false;
    }
  }
  return { matchedAll };
}
