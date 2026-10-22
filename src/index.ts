/**
 * 端到端编排入口（技术设计 §4.1 时序 / §4.5 Skill 对外契约 / §1.3 数据流）。
 *
 * 职责：解析请求 → 路由到提醒 / 推荐 / 画像 / 领券 → 组装文本与结构化输出 → 友好错误呈现。
 * 只做编排与呈现：不重写底层逻辑，仅通过各模块 index 出口调用。
 */

import { z } from 'zod';

import { AppError, ErrorCode, isAppError, toAppError } from './core/errors.js';
import { logger } from './core/logger.js';
import { autoBindCoupons, availableCoupons } from './mcp-client/index.js';
import { composeText, renderCoupons, renderOnboarding, renderProfileSummary, renderRecommendation, renderReminder, renderSchedule } from './output.js';
import {
  buildOnboardingQuestions,
  buildStartingProfile,
  configureProfile,
  getProfileSummary,
  readProfile,
  recordChoice,
  recordNegativeSignal,
  resetProfile,
  TASTE_TAG_OPTIONS,
} from './profile/index.js';
import { categoriesForTasteTag, DIETARY_OPTIONS, isScene, recommend, SCENE_VALUES } from './recommender/index.js';
import { buildHostScheduleSuggestion, evaluateReminder, formatActiveDays, setReminder } from './reminder/index.js';

import type { ToolResult } from './mcp-client/index.js';
import type { OnboardingPlan, ProfileClear, ProfilePatch, ProfileSummary } from './profile/index.js';
import type { RecommendOptions, RecommendResult } from './recommender/index.js';
import type { EvaluateReminderOptions, HostScheduleSuggestion, ReminderConfigInput, ReminderEvaluation } from './reminder/index.js';
import type {
  BoundCoupon,
  ChoiceRecord,
  ChoiceSource,
  CouponInfo,
  DiningChannel,
  MealCandidate,
  MealType,
  NutritionGoal,
  PriceBand,
  Recommendation,
  ReminderConfig,
  Scene,
  UserProfile,
} from './types/index.js';

/** 请求动作；缺省为对话式（先评估提醒，命中则提醒 + 推荐） */
export type SkillAction =
  | 'recommend'
  | 'onboarding'
  | 'configure'
  | 'reset-profile'
  | 'set-reminder'
  | 'show-profile'
  | 'bind-coupons';
/** 响应动作（含对话式 `chat`） */
export type SkillResponseAction = SkillAction | 'chat';

/** Skill 请求（对应设计 §4.5 输入参数） */
export interface SkillRequest {
  action?: SkillAction;
  /** 餐次（提醒 / 推荐） */
  mealType?: MealType;
  /** 提醒时间 'HH:mm' */
  time?: string;
  city?: string;
  /** 附近门店检索关键词（长度 1–100） */
  keyword?: string;
  addressId?: string;
  /** 预算：以**内存覆盖**本次推荐所用画像价格带（不落盘、不写回持久化画像，评审 R7） */
  budget?: PriceBand;
  /** 营养目标：以**内存覆盖**本次推荐（不落盘） */
  nutritionGoal?: NutritionGoal;
  /** 提醒生效日 0-6（空=每天） */
  days?: number[];
  /** 提前提醒分钟数 */
  advanceMinutes?: number;
  /** 免打扰区间 'HH:mm' */
  quietHours?: { start: string; end: string };
  timezone?: string;
  /** 用户明确选择的套餐 code（→ 强权重记录） */
  selectedMealCode?: string;
  /** 用户采纳默认推荐（→ 弱权重起始画像） */
  accepted?: boolean;
  /** 领券显式确认（写操作前置） */
  confirmed?: boolean;
  // ── v1.1.0 新增 ──────────────────────────────────────────────
  /** 取餐方式（configure 落盘 / 推荐使用，v1.1.0） */
  channel?: DiningChannel;
  /** 指定门店（跳过门店检索，v1.1.0） */
  storeCode?: string;
  /** 口味标签（configure 落盘，v1.1.0） */
  tasteTags?: string[];
  /** 推荐场景（v1.1.0） */
  scene?: Scene;
  /** 排除的候选 code（"换一换"，v1.1.0） */
  excludeCodes?: string[];
  /** 明确拒绝的套餐 code（负反馈：记负并排除，v1.1.0） */
  rejectedMealCode?: string;
  /** 口味纠偏：移除该口味标签并抑制匹配品类（v1.1.0） */
  dislikeTaste?: string;
  // ── v1.2.0 新增 ──────────────────────────────────────────────
  /** 过敏原标签（configure 落盘/推荐使用，v1.2.0） */
  allergies?: string[];
  /** 忌口标签（configure 落盘/推荐使用，v1.2.0） */
  avoid?: string[];
  /** 需清除的画像维度（configure，v1.2.0） */
  clearFields?: ProfileClear[];
}

/** Skill 响应 */
export interface SkillResponse {
  action: SkillResponseAction;
  /** 文本输出（提醒文案 + 推荐卡片 + 理由 + 券后价 + 可选脱敏画像摘要） */
  text: string;
  /** 结构化推荐结果（供宿主 / 调试） */
  recommendation?: Recommendation;
  /** 脱敏画像摘要 */
  profileSummary?: ProfileSummary;
  /** 提醒评估结果 */
  reminder?: ReminderEvaluation;
  /** 宿主定时建议 */
  schedule?: HostScheduleSuggestion;
  /** 领券结果 */
  bindResult?: BoundCoupon[];
  /** 采集计划（onboarding 动作，v1.1.0） */
  onboarding?: OnboardingPlan;
  /** 是否使用离线 / 降级数据 */
  degraded: boolean;
  /** 供上层展示的提示 */
  notices: string[];
}

/** 编排依赖（默认绑定真实模块；测试注入假实现，零网络 / 零 IO） */
export interface SkillDeps {
  evaluateReminder: (options?: EvaluateReminderOptions) => Promise<ReminderEvaluation>;
  recommend: (options: RecommendOptions) => Promise<RecommendResult>;
  readProfile: () => Promise<UserProfile>;
  recordChoice: (record: ChoiceRecord) => Promise<UserProfile>;
  buildStartingProfile: (primary: MealCandidate, storeCode?: string) => Promise<UserProfile>;
  getProfileSummary: () => Promise<ProfileSummary>;
  /** 生成采集待问清单（v1.1.0） */
  buildOnboardingQuestions: (profile: UserProfile) => OnboardingPlan;
  /** 应用采集/纠偏补丁并落盘（v1.1.0） */
  configureProfile: (patch: ProfilePatch) => Promise<UserProfile>;
  /** 记录负反馈（品类权重衰减，v1.1.0） */
  recordNegativeSignal: (category: string) => Promise<UserProfile>;
  /** 重置画像为默认（v1.2.0） */
  resetProfile: () => Promise<UserProfile>;
  autoBindCoupons: () => Promise<ToolResult<BoundCoupon[]>>;
  availableCoupons: () => Promise<ToolResult<CouponInfo[]>>;
  setReminder: (input: ReminderConfigInput) => Promise<ReminderConfig>;
  buildHostScheduleSuggestion: (config: Parameters<typeof buildHostScheduleSuggestion>[0]) => HostScheduleSuggestion;
}

/** 默认依赖（绑定真实实现） */
export const defaultSkillDeps: SkillDeps = {
  evaluateReminder: (options) => evaluateReminder(options),
  recommend: (options) => recommend(options),
  readProfile: () => readProfile(),
  recordChoice: (record) => recordChoice(record),
  buildStartingProfile: (primary, storeCode) => buildStartingProfile(primary, undefined, storeCode ?? ''),
  getProfileSummary: () => getProfileSummary(),
  buildOnboardingQuestions: (profile) => buildOnboardingQuestions(profile),
  configureProfile: (patch) => configureProfile(patch),
  recordNegativeSignal: (category) => recordNegativeSignal(category),
  resetProfile: () => resetProfile(),
  autoBindCoupons: () => autoBindCoupons(),
  availableCoupons: () => availableCoupons(),
  setReminder: (input) => setReminder(input),
  buildHostScheduleSuggestion: (config) => buildHostScheduleSuggestion(config),
};

// ── 入参校验（需求 AC 6.6-2 / 6.6-3） ─────────────────────────────────────────

const nonNegativeNumber = z.number().finite().nonnegative({ message: '数值必须 ≥ 0' });
const budgetSchema = z
  .object({ min: nonNegativeNumber, max: nonNegativeNumber })
  .refine((value) => value.max >= value.min, { message: '预算上限 max 不能小于下限 min' });
const nutritionGoalSchema = z.object({
  maxKcal: nonNegativeNumber.optional(),
  minProtein: nonNegativeNumber.optional(),
});
const keywordSchema = z.string().min(1, '关键词不能为空').max(100, '关键词长度不能超过 100');

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : '参数'}: ${issue.message}`)
    .join('；');
}

/** 校验请求入参；非法则抛 `AppError(VALIDATION_ERROR)`（友好中文、不含堆栈） */
export function validateRequest(request: SkillRequest): void {
  if (request.budget) {
    const parsed = budgetSchema.safeParse(request.budget);
    if (!parsed.success) {
      throw new AppError({ code: ErrorCode.VALIDATION_ERROR, message: `预算不合法：${formatIssues(parsed.error)}` });
    }
  }
  if (request.nutritionGoal) {
    const parsed = nutritionGoalSchema.safeParse(request.nutritionGoal);
    if (!parsed.success) {
      throw new AppError({ code: ErrorCode.VALIDATION_ERROR, message: `营养目标不合法：${formatIssues(parsed.error)}` });
    }
  }
  if (request.keyword !== undefined) {
    const parsed = keywordSchema.safeParse(request.keyword);
    if (!parsed.success) {
      throw new AppError({ code: ErrorCode.VALIDATION_ERROR, message: `关键词不合法：${formatIssues(parsed.error)}` });
    }
  }
  if (request.scene !== undefined && !isScene(request.scene)) {
    throw new AppError({
      code: ErrorCode.VALIDATION_ERROR,
      message: `场景不合法：仅支持 ${SCENE_VALUES.join('/')}`,
    });
  }
  if (request.channel !== undefined && request.channel !== 'delivery' && request.channel !== 'nearby') {
    throw new AppError({ code: ErrorCode.VALIDATION_ERROR, message: '取餐方式不合法：仅支持 delivery / nearby' });
  }
  if (request.tasteTags !== undefined) {
    const invalid = request.tasteTags.filter((tag) => !(TASTE_TAG_OPTIONS as readonly string[]).includes(tag));
    if (invalid.length > 0) {
      throw new AppError({
        code: ErrorCode.VALIDATION_ERROR,
        message: `口味标签不合法：${invalid.join('、')}（支持：${TASTE_TAG_OPTIONS.join('/')}）`,
      });
    }
  }
  const dietaryTags = [...(request.allergies ?? []), ...(request.avoid ?? [])];
  if (dietaryTags.length > 0) {
    const invalid = dietaryTags.filter((tag) => !(DIETARY_OPTIONS as readonly string[]).includes(tag));
    if (invalid.length > 0) {
      throw new AppError({
        code: ErrorCode.VALIDATION_ERROR,
        message: `忌口/过敏标签不合法：${invalid.join('、')}（支持：${DIETARY_OPTIONS.join('/')}）`,
      });
    }
  }
  if (request.clearFields !== undefined) {
    if (request.action !== 'configure') {
      throw new AppError({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'clearFields（--clear）仅在 configure 动作下可用',
      });
    }
    const allowed: ProfileClear[] = ['location', 'taste', 'budget', 'nutrition', 'dietary'];
    const invalid = request.clearFields.filter((field) => !allowed.includes(field));
    if (invalid.length > 0) {
      throw new AppError({
        code: ErrorCode.VALIDATION_ERROR,
        message: `clear 维度不合法：${invalid.join('、')}（支持：${allowed.join('/')}）`,
      });
    }
  }
}

/** 将 `AppError` 映射为友好中文提示（不暴露内部堆栈 / 技术细节） */
export function friendlyErrorMessage(error: unknown): string {
  const appError = toAppError(error);
  switch (appError.code) {
    case ErrorCode.TOKEN_MISSING:
      return '未配置麦当劳 MCP Token（MCD_MCP_TOKEN），暂时无法获取实时数据。请配置 Token 后重试，或设置 MCD_OFFLINE=1 使用离线演示数据。';
    case ErrorCode.AUTH_FAILED:
      return 'MCP Token 无效或已过期，请更新 MCD_MCP_TOKEN 后重试。';
    case ErrorCode.RATE_LIMITED:
      return '请求过于频繁，请稍后再试。';
    case ErrorCode.TIMEOUT:
      return '网络请求超时，请稍后重试。';
    case ErrorCode.EMPTY_RESULT:
      return appError.message.includes('门店')
        ? '没有找到可用的门店，可以换个城市或关键词，或稍后重试。'
        : '没有找到可推荐的套餐，可以换个门店或稍后重试。';
    case ErrorCode.PARSE_ERROR:
      return '数据解析失败，已跳过该部分，请稍后重试。';
    case ErrorCode.VALIDATION_ERROR:
      return appError.message;
    case ErrorCode.IO_ERROR:
      return '本地数据读写失败，请稍后重试。';
    default:
      return '抱歉，处理时遇到了一点问题，请稍后重试。';
  }
}

function applyRequestOverrides(profile: UserProfile, request: SkillRequest): UserProfile {
  const hasDietary = (request.avoid?.length ?? 0) > 0 || (request.allergies?.length ?? 0) > 0;
  if (!request.budget && !request.nutritionGoal && !hasDietary) {
    return profile;
  }
  const baseDietary = profile.preferences.dietary ?? { avoid: [], allergies: [] };
  const dietary = hasDietary
    ? {
        avoid: [...new Set([...baseDietary.avoid, ...(request.avoid ?? [])])],
        allergies: [...new Set([...baseDietary.allergies, ...(request.allergies ?? [])])],
      }
    : profile.preferences.dietary;
  return {
    ...profile,
    preferences: {
      ...profile.preferences,
      ...(request.budget ? { priceBand: request.budget } : {}),
      ...(request.nutritionGoal ? { nutritionGoal: request.nutritionGoal } : {}),
      ...(dietary ? { dietary } : {}),
    },
  };
}

function toChoiceRecord(candidate: MealCandidate, storeCode: string, source: ChoiceSource): ChoiceRecord {
  return {
    timestamp: new Date().toISOString(),
    storeCode,
    mealCode: candidate.code,
    mealName: candidate.name,
    effectivePrice: candidate.effectivePrice,
    ...(candidate.category ? { category: candidate.category } : {}),
    source,
  };
}

/**
 * 供上层 / 测试复用：执行推荐并按需处理反馈（v1.1.0：正/负/换一换）。
 *
 * 处理顺序：① 口味纠偏前置 → ② 明确拒绝（记负 + 排除重推）→ ③ 正向记录（强/弱）。
 */
export async function runRecommendation(
  request: SkillRequest,
  deps: SkillDeps,
  timezone?: string,
): Promise<RecommendResult> {
  // ① 口味纠偏：移除标签 + 抑制匹配品类
  if (request.dislikeTaste) {
    await deps.configureProfile({ taste: { removeTags: [request.dislikeTaste] } });
    for (const category of categoriesForTasteTag(request.dislikeTaste)) {
      await deps.recordNegativeSignal(category);
    }
  }

  const excludeCodes = [...(request.excludeCodes ?? [])];
  const buildOptions = (profile: UserProfile): RecommendOptions => ({
    profile,
    ...(request.city ? { city: request.city } : {}),
    ...(request.keyword ? { keyword: request.keyword } : {}),
    ...(request.addressId ? { addressId: request.addressId } : {}),
    ...(request.storeCode ? { storeCode: request.storeCode } : {}),
    ...(request.channel ? { channel: request.channel } : {}),
    ...(request.mealType ? { mealType: request.mealType } : {}),
    ...(request.scene ? { scene: request.scene } : {}),
    ...(excludeCodes.length > 0 ? { excludeCodes: [...excludeCodes] } : {}),
    ...(timezone ? { timezone } : {}),
  });

  let result = await deps.recommend(buildOptions(applyRequestOverrides(await deps.readProfile(), request)));

  // ② 明确拒绝：对该餐品品类记负反馈并排除后重推
  if (request.rejectedMealCode) {
    const rejected = [result.recommendation.primary, ...result.recommendation.alternatives].find(
      (item) => item.code === request.rejectedMealCode,
    );
    if (rejected?.category) {
      await deps.recordNegativeSignal(rejected.category);
    }
    if (!excludeCodes.includes(request.rejectedMealCode)) {
      excludeCodes.push(request.rejectedMealCode);
    }
    result = await deps.recommend(buildOptions(applyRequestOverrides(await deps.readProfile(), request)));
  }

  // ③ 正向记录：明确选择（强权重） / 采纳默认（弱权重起始画像）
  if (request.selectedMealCode) {
    const candidate = [result.recommendation.primary, ...result.recommendation.alternatives].find(
      (item) => item.code === request.selectedMealCode,
    );
    if (candidate) {
      await deps.recordChoice(toChoiceRecord(candidate, result.store.storeCode, 'explicit'));
    }
  } else if (request.accepted) {
    await deps.buildStartingProfile(result.recommendation.primary, result.store.storeCode);
  }

  return result;
}

async function handleChat(request: SkillRequest, deps: SkillDeps): Promise<SkillResponse> {
  const evaluation = await deps.evaluateReminder();
  if (evaluation.decision.status === 'trigger') {
    const result = await runRecommendation(request, deps, evaluation.decision.timezone);
    const text = composeText([
      renderReminder(evaluation),
      renderRecommendation(result.recommendation, result.notices),
    ]);
    return {
      action: 'chat',
      text,
      recommendation: result.recommendation,
      reminder: evaluation,
      schedule: evaluation.schedule,
      degraded: evaluation.degraded || result.recommendation.degraded,
      notices: result.notices,
    };
  }
  return {
    action: 'chat',
    text: renderReminder(evaluation),
    reminder: evaluation,
    schedule: evaluation.schedule,
    degraded: evaluation.degraded,
    notices: [],
  };
}

async function handleRecommend(request: SkillRequest, deps: SkillDeps): Promise<SkillResponse> {
  const result = await runRecommendation(request, deps);
  const summary = await deps.getProfileSummary();
  return {
    action: 'recommend',
    text: composeText([
      renderRecommendation(result.recommendation, result.notices),
      renderProfileSummary(summary),
    ]),
    recommendation: result.recommendation,
    profileSummary: summary,
    degraded: result.recommendation.degraded,
    notices: result.notices,
  };
}

/** 采集：生成待问清单（v1.1.0） */
async function handleOnboarding(deps: SkillDeps): Promise<SkillResponse> {
  const profile = await deps.readProfile();
  const plan = deps.buildOnboardingQuestions(profile);
  return {
    action: 'onboarding',
    text: renderOnboarding(plan),
    onboarding: plan,
    degraded: false,
    notices: [],
  };
}

/** 由请求构造画像补丁（采集/配置） */
function buildProfilePatch(request: SkillRequest): ProfilePatch {
  const location: NonNullable<ProfilePatch['location']> = {};
  if (request.city) location.city = request.city;
  if (request.storeCode) location.defaultStoreCode = request.storeCode;
  if (request.addressId) location.defaultAddressId = request.addressId;
  if (request.channel) location.channel = request.channel;

  const patch: ProfilePatch = {};
  if (Object.keys(location).length > 0) patch.location = location;
  if (request.budget) patch.priceBand = request.budget;
  if (request.nutritionGoal) patch.nutritionGoal = request.nutritionGoal;
  if (request.mealType) patch.mealType = request.mealType;
  const tasteTags = request.tasteTags?.filter((tag) => tag.trim().length > 0);
  if (tasteTags && tasteTags.length > 0) patch.taste = { tags: tasteTags };
  const allergies = request.allergies?.filter((tag) => tag.trim().length > 0);
  const avoid = request.avoid?.filter((tag) => tag.trim().length > 0);
  if ((allergies && allergies.length > 0) || (avoid && avoid.length > 0)) {
    patch.dietary = { ...(allergies ? { allergies } : {}), ...(avoid ? { avoid } : {}) };
  }
  if (request.clearFields && request.clearFields.length > 0) patch.clear = request.clearFields;
  return patch;
}

/** 落盘采集/配置（v1.1.0） */
async function handleConfigure(request: SkillRequest, deps: SkillDeps): Promise<SkillResponse> {
  const patch = buildProfilePatch(request);
  const saved = Object.keys(patch).length > 0;
  if (saved) {
    await deps.configureProfile(patch);
  }
  const summary = await deps.getProfileSummary();
  return {
    action: 'configure',
    text: composeText([
      saved ? '✅ 已记录你的偏好（脱敏保存，仅存必要信息）。' : '未提供可保存的信息。',
      renderProfileSummary(summary),
    ]),
    profileSummary: summary,
    degraded: false,
    notices: [],
  };
}

/** 重置画像（破坏性操作，须显式确认，v1.2.0） */
async function handleResetProfile(request: SkillRequest, deps: SkillDeps): Promise<SkillResponse> {
  if (!request.confirmed) {
    return {
      action: 'reset-profile',
      text: '重置画像会清空你的所有偏好（位置/口味/预算/忌口等），且不可恢复。确认后回复“确认重置”（confirmed=true），我再执行。',
      degraded: false,
      notices: [],
    };
  }
  await deps.resetProfile();
  const summary = await deps.getProfileSummary();
  return {
    action: 'reset-profile',
    text: composeText(['✅ 已重置你的画像。', renderProfileSummary(summary)]),
    profileSummary: summary,
    degraded: false,
    notices: [],
  };
}

async function handleSetReminder(request: SkillRequest, deps: SkillDeps): Promise<SkillResponse> {
  if (!request.mealType || !request.time) {
    return {
      action: 'set-reminder',
      text: '请告诉我餐次与时间，例如「每天 12:00 提醒我吃午餐」。',
      degraded: false,
      notices: [],
    };
  }
  const input: ReminderConfigInput = {
    mealType: request.mealType,
    time: request.time,
    ...(request.days ? { days: request.days } : {}),
    ...(typeof request.advanceMinutes === 'number' ? { advanceMinutes: request.advanceMinutes } : {}),
    ...(request.quietHours ? { quietHours: request.quietHours } : {}),
    ...(request.timezone ? { timezone: request.timezone } : {}),
  };
  const config = await deps.setReminder(input);
  const schedule = deps.buildHostScheduleSuggestion(config);
  const label = config.mealType === 'lunch' ? '午餐' : '晚餐';
  return {
    action: 'set-reminder',
    text: composeText([
      `已设定${label}提醒：${formatActiveDays(config.days)} ${config.time}（含提前量与免打扰规则）。`,
      renderSchedule(schedule),
    ]),
    schedule,
    degraded: false,
    notices: [],
  };
}

async function handleShowProfile(deps: SkillDeps): Promise<SkillResponse> {
  const summary = await deps.getProfileSummary();
  return {
    action: 'show-profile',
    text: renderProfileSummary(summary),
    profileSummary: summary,
    degraded: false,
    notices: [],
  };
}

async function handleBindCoupons(request: SkillRequest, deps: SkillDeps): Promise<SkillResponse> {
  const coupons = await deps.availableCoupons();
  if (!request.confirmed) {
    return {
      action: 'bind-coupons',
      text: composeText([
        '以下券会改变你的券包，需要你确认后我才会领取：',
        renderCoupons(coupons.data),
        '确认后回复“确认领取”（confirmed=true），我再执行。',
      ]),
      degraded: coupons.degraded,
      notices: [],
    };
  }
  const bound = await deps.autoBindCoupons();
  const list = bound.data.map((coupon) => `・${coupon.couponCode ?? coupon.couponId}`).join('\n');
  return {
    action: 'bind-coupons',
    text: composeText([
      `已为你领取 ${bound.data.length} 张券：`,
      list.length > 0 ? list : '（无新增券）',
      bound.degraded ? '（离线演示数据，仅供参考）' : undefined,
    ]),
    bindResult: bound.data,
    degraded: coupons.degraded || bound.degraded,
    notices: [],
  };
}

/**
 * 处理一次 Skill 请求（端到端编排入口）。
 *
 * 任何异常都会被捕获并转为友好文本，**绝不抛出**（对应设计 §4.5 错误输出 / §6.6）。
 */
export async function handleRequest(
  request: SkillRequest = {},
  deps: SkillDeps = defaultSkillDeps,
): Promise<SkillResponse> {
  const action = request.action ?? 'chat';
  try {
    validateRequest(request);
    switch (action) {
      case 'recommend':
        return await handleRecommend(request, deps);
      case 'onboarding':
        return await handleOnboarding(deps);
      case 'configure':
        return await handleConfigure(request, deps);
      case 'reset-profile':
        return await handleResetProfile(request, deps);
      case 'set-reminder':
        return await handleSetReminder(request, deps);
      case 'show-profile':
        return await handleShowProfile(deps);
      case 'bind-coupons':
        return await handleBindCoupons(request, deps);
      default:
        return await handleChat(request, deps);
    }
  } catch (error) {
    const appError = toAppError(error);
    logger.warn('Skill 请求处理失败', {
      action,
      code: isAppError(error) ? error.code : ErrorCode.UNKNOWN,
    });
    return {
      action,
      text: friendlyErrorMessage(appError),
      degraded: false,
      notices: ['本次处理未完成，请按提示重试。'],
    };
  }
}

export { AppError, ErrorCode } from './core/errors.js';
export {
  composeText,
  renderCoupons,
  renderOnboarding,
  renderProfileSummary,
  renderRecommendation,
  renderReminder,
  renderSchedule,
} from './output.js';
