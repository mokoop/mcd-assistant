/**
 * 组装（技术设计 §4.2 步骤 6）：排序 → 主推 + ≤2 备选 + 可解释理由（≥2 条）。
 */

import { AppError, ErrorCode } from '../core/errors.js';

import { sceneLabel, type EffectiveScene } from './scene.js';

import type { MealCandidate, Recommendation, UserProfile } from '../types/index.js';

/** 组装参数 */
export interface AssembleParams {
  /** 已打分的候选（`score`/`breakdown` 已写入） */
  candidates: MealCandidate[];
  profile: UserProfile;
  /** 营养约束无满足项，已回退最接近项 */
  nutritionRelaxed: boolean;
  /** 饮食禁忌/过敏原无法完全满足，已回退命中最少项（v1.2.0） */
  dietaryRelaxed?: boolean;
  /** 是否所有候选都匹配到营养数据 */
  nutritionComplete: boolean;
  /** 任一依赖降级 */
  degraded: boolean;
  /** 是否冷启动（v1.1.0） */
  coldStart?: boolean;
  /** 实际生效场景（v1.1.0） */
  scene?: EffectiveScene;
  timezone?: string;
  now?: Date;
}

/** 组装结果 */
export interface AssembleResult {
  recommendation: Recommendation;
  /** 供上层展示的提示 */
  notices: string[];
}

function money(value: number): string {
  return `¥${value.toFixed(2)}`;
}

/** 生成可解释理由（保证 ≥2 条） */
export function buildReasons(
  candidate: MealCandidate,
  profile: UserProfile,
  nutritionComplete: boolean,
): string[] {
  const reasons: string[] = [];
  const category = candidate.category;

  if (category) {
    const weight = profile.preferences.categoryWeights[category] ?? 0;
    if (weight > 0) {
      reasons.push(`符合你偏好的「${category}」口味（偏好度 ${Math.round(weight * 100)}%）`);
    } else {
      reasons.push(`推荐尝试「${category}」品类，换个口味`);
    }
  }

  const band = profile.preferences.priceBand;
  if (band.max > 0 && candidate.effectivePrice >= band.min && candidate.effectivePrice <= band.max) {
    reasons.push(`券后价 ${money(candidate.effectivePrice)} 在你的可接受价格带内`);
  }

  const preferredTaste = profile.preferences.taste?.tags ?? [];
  if (preferredTaste.length > 0 && candidate.tasteTags && candidate.tasteTags.length > 0) {
    const matched = preferredTaste.filter((tag) => candidate.tasteTags?.includes(tag));
    if (matched.length > 0) {
      reasons.push(`符合你偏好的「${matched.join('、')}」口味`);
    }
  }

  if (candidate.popularity === 1) {
    reasons.push('门店热销，出餐快、选择稳妥');
  }

  if (typeof candidate.discount === 'number' && candidate.discount > 0) {
    reasons.push(`券后省 ${money(candidate.discount)}（原价 ${money(candidate.price)}）`);
  }

  if (candidate.nutrition?.energyKcal !== undefined) {
    reasons.push(`热量约 ${candidate.nutrition.energyKcal}kcal，供参考`);
  } else if (!nutritionComplete) {
    reasons.push('营养数据暂缺，热量信息仅供参考');
  }

  if (reasons.length < 2) {
    reasons.push(`综合评分 ${candidate.score.toFixed(3)}，性价比之选`);
  }
  if (reasons.length < 2) {
    reasons.push('出餐稳定，取餐方便');
  }
  return reasons.slice(0, 4);
}

function compareCandidates(a: MealCandidate, b: MealCandidate): number {
  if (b.score !== a.score) {
    return b.score - a.score;
  }
  return a.effectivePrice - b.effectivePrice;
}

/** 组装推荐结果 */
export function assembleRecommendation(params: AssembleParams): AssembleResult {
  const { candidates, profile, nutritionRelaxed, nutritionComplete, degraded, timezone, now, coldStart, scene } =
    params;
  const { dietaryRelaxed } = params;
  if (candidates.length === 0) {
    throw new AppError({ code: ErrorCode.EMPTY_RESULT, message: '没有可推荐的套餐' });
  }

  const sorted = [...candidates].sort(compareCandidates);
  const [primary, ...rest] = sorted;
  const alternatives = rest.slice(0, 2);
  const reasons = buildReasons(primary, profile, nutritionComplete);

  const recommendation: Recommendation = {
    primary,
    alternatives,
    reasons,
    generatedAt: (now ?? new Date()).toISOString(),
    degraded,
    ...(timezone ? { timezone } : {}),
    ...(scene ? { scene } : {}),
    ...(coldStart ? { coldStart: true } : {}),
  };

  const notices: string[] = [];
  if (coldStart) {
    // 仅在确实命中门店热销数据时提"热销"，避免虚构（需求 AC 6.2-3）
    const hasHot = candidates.some((candidate) => candidate.popularity === 1);
    notices.push(
      hasHot
        ? '这是根据门店热销与券后性价比给你的起点；告诉我口味/预算，我会更懂你。'
        : '这是根据券后性价比给你的起点；告诉我口味/预算，我会更懂你。',
    );
  }
  if (scene) {
    notices.push(`已按「${sceneLabel(scene)}」场景推荐。`);
  }
  if (nutritionRelaxed) {
    notices.push('未找到满足热量上限的套餐，以下为最接近的选项（营养数据仅供参考）');
  } else if (!nutritionComplete) {
    notices.push('部分餐品营养数据缺失，热量信息仅供参考');
  }
  const dietary = profile.preferences.dietary;
  const hasDietaryRestriction = Boolean(dietary && (dietary.allergies.length > 0 || dietary.avoid.length > 0));
  if (dietaryRelaxed) {
    notices.push('严格按你的忌口/过敏筛选后无可选套餐，以下为命中最少的选项，请务必自行确认成分（近似筛选）。');
  } else if (hasDietaryRestriction) {
    notices.push(
      '已按你的忌口/过敏设置做近似筛选（基于名称关键词），可能存在遗漏；严重过敏请以官方信息或门店确认为准。',
    );
  }
  if (degraded) {
    notices.push('当前为离线演示数据，价格与餐品以官方实时结果为准');
  }

  return { recommendation, notices };
}
