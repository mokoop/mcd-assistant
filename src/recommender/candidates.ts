/**
 * 候选生成（技术设计 §4.2 步骤 1）：`query-meals`（门店可售）→ 候选；
 * 逐项用 `query-meal-detail` 补全（仅读取名称/价格，不用于套餐内替换）。
 */

import { inferTasteTags } from './taste.js';

import type { RecommendDeps } from './deps.js';
import type { StoreMenuQuery } from '../mcp-client/types.js';
import type { MealItem, MealCandidate } from '../types/index.js';


/** 候选生成结果 */
export interface CandidateBuildResult {
  candidates: MealCandidate[];
  degraded: boolean;
}

/** `query-meals` 条目 → 候选（券后价初值 = 原价） */
export function toCandidate(item: MealItem): MealCandidate {
  const price = typeof item.price === 'number' && Number.isFinite(item.price) ? item.price : 0;
  return {
    code: item.code,
    name: item.name,
    ...(item.category ? { category: item.category } : {}),
    price,
    effectivePrice: price,
    score: 0,
    breakdown: {},
  };
}

/**
 * 生成候选并用套餐详情补全（详情失败不影响该候选，保留门店菜单信息）。
 *
 * 同时标注两项 v1.1.0 信号：
 * - `popularity`：命中门店热销（`query-meals.frequent`）→1；热销集合缺失→0.5（未知）；未命中→0；
 * - `tasteTags`：由名称/品类近似推断口味标签。
 */
export async function buildCandidates(
  deps: RecommendDeps,
  query: StoreMenuQuery,
): Promise<CandidateBuildResult> {
  const meals = await deps.queryMeals(query);
  const frequentList = meals.data.frequent ?? [];
  const frequent = new Set(frequentList);
  const hasFrequent = frequentList.length > 0;

  const candidates = Object.values(meals.data.meals).map((item) => {
    const candidate = toCandidate(item);
    // 热销：命中=1；热销集合为空（离线/门店无数据）=0.5（中性，避免误判）；否则=0
    candidate.popularity = hasFrequent ? (frequent.has(candidate.code) ? 1 : 0) : 0.5;
    return candidate;
  });

  let degraded = meals.degraded;
  const details = await Promise.allSettled(
    candidates.map((candidate) => deps.queryMealDetail({ ...query, code: candidate.code })),
  );

  candidates.forEach((candidate, index) => {
    const settled = details[index];
    if (settled.status !== 'fulfilled') {
      return;
    }
    if (settled.value.degraded) {
      degraded = true;
    }
    const detail = settled.value.data;
    if (detail.name) {
      candidate.name = detail.name;
    }
    if (typeof detail.price === 'number' && detail.price > 0) {
      candidate.price = detail.price;
      candidate.effectivePrice = detail.price;
    }
  });

  // 口味标签在名称补全后推断
  for (const candidate of candidates) {
    candidate.tasteTags = inferTasteTags(candidate.name, candidate.category);
  }

  return { candidates, degraded };
}
