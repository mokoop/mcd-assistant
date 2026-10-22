/**
 * 冷启动引导（onboarding）— 主动信息采集（v1.1.0 设计 §2.4）。
 *
 * 职责：根据当前画像生成**结构化待问清单**（最小必要集），并把回收到的答案合并进画像。
 * 分层约束：本模块仅依赖 `src/types` 与同模块的 `profile`，**不依赖 recommender**。
 *
 * 交互约定：Skill 无独立 UI，`buildOnboardingQuestions` 输出清单由宿主（LLM）转述给用户，
 * 用户回答后由宿主构造 `OnboardingAnswers` 交给 `applyOnboardingAnswers` 落盘。
 */

import { applyProfilePatch } from './profile.js';

import type { ProfilePatch } from './profile.js';
import type {
  DiningChannel,
  NutritionGoal,
  PriceBand,
  UserProfile,
} from '../types/index.js';

/**
 * 口味标签候选（与 `recommender/taste.ts` 的 `TASTE_RULES` 键保持一致）。
 * 说明：口味为关键词近似推断，仅供参考。
 */
export const TASTE_TAG_OPTIONS = ['辣', '清淡', '甜', '鸡', '牛', '鱼'] as const;

/**
 * 饮食禁忌 / 过敏原候选（与 `recommender/dietary.ts` 的 `DIETARY_RULES` 键保持一致）。
 * 说明：为名称关键词**近似筛选**，非官方成分数据；严重过敏请以官方/门店确认为准。
 */
export const DIETARY_TAG_OPTIONS = ['牛肉', '猪肉', '鸡肉', '海鲜', '乳制品', '花生坚果', '蛋', '大豆'] as const;

/** 问题类型 */
export type QuestionKind = 'text' | 'single' | 'multi' | 'range' | 'number';

/** 单个待问项 */
export interface OnboardingQuestion {
  /** 答案键（与 `OnboardingAnswers` 字段对应） */
  key: string;
  /** 面向用户的问题 */
  label: string;
  /** 为什么问（让用户理解价值，降低中断率） */
  why: string;
  kind: QuestionKind;
  /** 建议填写（用户仍可跳过） */
  required: boolean;
  options?: string[];
}

/** 采集计划 */
export interface OnboardingPlan {
  /** 是否处于冷启动（无画像） */
  coldStart: boolean;
  /** 待问清单；为空表示画像已足够，无需再问 */
  questions: OnboardingQuestion[];
}

/** 采集答案（由宿主从用户回答构造） */
export interface OnboardingAnswers {
  city?: string;
  defaultStoreCode?: string;
  defaultAddressId?: string;
  channel?: DiningChannel;
  budget?: PriceBand;
  tasteTags?: string[];
  nutritionGoal?: NutritionGoal;
  /** 过敏原标签（v1.2.0） */
  allergies?: string[];
  /** 忌口标签（v1.2.0） */
  avoid?: string[];
}

function hasLocation(profile: UserProfile): boolean {
  const loc = profile.location;
  return Boolean(loc && (loc.city || loc.defaultStoreCode || loc.defaultAddressId || loc.channel));
}

function hasBudget(profile: UserProfile): boolean {
  return profile.preferences.priceBand.max > 0;
}

function hasTaste(profile: UserProfile): boolean {
  return (profile.preferences.taste?.tags.length ?? 0) > 0;
}

function hasDietary(profile: UserProfile): boolean {
  const dietary = profile.preferences.dietary;
  return Boolean(dietary && (dietary.avoid.length > 0 || dietary.allergies.length > 0));
}

function hasNutritionGoal(profile: UserProfile): boolean {
  const goal = profile.preferences.nutritionGoal;
  return Boolean(goal && (typeof goal.maxKcal === 'number' || typeof goal.minProtein === 'number'));
}

/**
 * 依据当前画像生成待问清单（v1.1.0 §2.4）。
 *
 * 规则：
 * - 冷启动 → 返回全部最小必要集问题；
 * - 已有画像 → 仅返回**缺失字段**的问题；无缺失则 `questions=[]`（宿主据此提示"已具备画像"）。
 */
export function buildOnboardingQuestions(profile: UserProfile): OnboardingPlan {
  const questions: OnboardingQuestion[] = [];

  if (!hasLocation(profile)) {
    questions.push({
      key: 'channel',
      label: '你通常怎么取餐？到店自取，还是麦乐送？',
      why: '决定按附近门店还是配送地址来查可售套餐。',
      kind: 'single',
      required: true,
      options: ['到店(附近门店)', '麦乐送'],
    });
    questions.push({
      key: 'city',
      label: '你在哪个城市（或商圈/门店）？到店时用于找最近的店。',
      why: '定位附近门店，避免推荐到不可达的店。',
      kind: 'text',
      required: true,
    });
  }

  if (!hasBudget(profile)) {
    questions.push({
      key: 'budget',
      label: '一餐预算大概多少？（如 20–40 元）',
      why: '把推荐控制在你可接受的价格带内，并优先券后更省的。',
      kind: 'range',
      required: true,
    });
  }

  if (!hasTaste(profile)) {
    questions.push({
      key: 'tasteTags',
      label: '口味偏好？（可多选，也可跳过）',
      why: '据此优先推荐合口味的套餐。',
      kind: 'multi',
      required: true,
      options: [...TASTE_TAG_OPTIONS],
    });
  }

  if (!hasDietary(profile)) {
    questions.push({
      key: 'dietary',
      label: '有忌口或过敏原吗？（可多选，也可跳过）',
      why: '据此过滤含过敏原/忌口的套餐（近似筛选，仅供参考）。',
      kind: 'multi',
      required: false,
      options: [...DIETARY_TAG_OPTIONS],
    });
  }

  if (!hasNutritionGoal(profile)) {
    questions.push({
      key: 'nutritionGoal',
      label: '需要控制热量吗？（可选，如单餐热量上限 kcal）',
      why: '控糖/健身时据此加约束；不需要可跳过。',
      kind: 'number',
      required: false,
    });
  }

  return { coldStart: !hasLocation(profile) && !hasBudget(profile) && !hasTaste(profile), questions };
}

/**
 * 将采集答案合并进画像（**纯函数**，落盘由 `configureProfile` 负责）。
 *
 * 仅应用已提供的字段；未提供字段沿用原值（用户可跳过任一项）。
 */
export function applyOnboardingAnswers(profile: UserProfile, answers: OnboardingAnswers): UserProfile {
  const location: ProfilePatch['location'] = {};
  if (answers.city !== undefined) location.city = answers.city;
  if (answers.defaultStoreCode !== undefined) location.defaultStoreCode = answers.defaultStoreCode;
  if (answers.defaultAddressId !== undefined) location.defaultAddressId = answers.defaultAddressId;
  if (answers.channel !== undefined) location.channel = answers.channel;

  const tasteTags = answers.tasteTags?.filter((tag) => tag.trim().length > 0);
  const allergies = answers.allergies?.filter((tag) => tag.trim().length > 0);
  const avoid = answers.avoid?.filter((tag) => tag.trim().length > 0);

  const patch: ProfilePatch = {};
  if (Object.keys(location).length > 0) patch.location = location;
  if (answers.budget) patch.priceBand = answers.budget;
  if (tasteTags && tasteTags.length > 0) patch.taste = { tags: tasteTags };
  if (answers.nutritionGoal) patch.nutritionGoal = answers.nutritionGoal;
  if ((allergies && allergies.length > 0) || (avoid && avoid.length > 0)) {
    patch.dietary = { ...(allergies ? { allergies } : {}), ...(avoid ? { avoid } : {}) };
  }

  return applyProfilePatch(profile, patch);
}
