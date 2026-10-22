/**
 * 用户偏好画像模块（scope: profile）对外出口。
 *
 * 供 `recommender` / `index` 调用：读取、保存、记录选择、构建起始画像、脱敏摘要。
 * 业务约束：本模块只依赖 `src/types` 与 `src/core`，不依赖其他业务模块。
 */

export {
  applyChoice,
  applyProfilePatch,
  buildStartingProfile,
  configureProfile,
  getProfileSummary,
  isColdStart,
  readProfile,
  recordChoice,
  recordNegativeSignal,
  resetProfile,
  saveProfile,
} from './profile.js';
export {
  applyOnboardingAnswers,
  buildOnboardingQuestions,
  DIETARY_TAG_OPTIONS,
  TASTE_TAG_OPTIONS,
} from './onboarding.js';
export { createProfileStore } from './store.js';
export { createDefaultProfile, PROFILE_VERSION } from './defaults.js';
export {
  DEFAULT_PROFILE_CONFIG,
  resolveProfileConfig,
  resolveProfileFilePath,
  resolveProfileTimeZone,
} from './config.js';
export {
  applyNegativeSignal,
  deriveTimeSlot,
  mergeTags,
  mergeTasteTags,
  normalizeWeights,
  updateCategoryWeights,
  updateMealTypePreference,
  updatePriceBand,
} from './ema.js';

export type { ProfileClear, ProfilePatch, ProfileSummary } from './profile.js';
export type { OnboardingAnswers, OnboardingPlan, OnboardingQuestion, QuestionKind } from './onboarding.js';
export type { ProfileStore } from './store.js';
export type { ProfileConfig } from './config.js';
export type { TimeSlot } from './ema.js';
