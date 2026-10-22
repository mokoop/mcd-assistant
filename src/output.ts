/**
 * 文本呈现层（技术设计 §4.5：文本输出 = 提醒文案 + 推荐卡片 + ≥2 理由 + 券后价 + 脱敏画像摘要）。
 *
 * 纯函数：结构化数据 → 面向用户的文本；不访问网络/文件，便于单测。
 */

import type { OnboardingPlan, ProfileSummary } from './profile/index.js';
import type { HostScheduleSuggestion, ReminderEvaluation } from './reminder/index.js';
import type { CouponInfo, MealCandidate, Recommendation } from './types/index.js';

/** 金额格式化 */
export function money(value: number): string {
  return `¥${value.toFixed(2)}`;
}

function discountNote(candidate: MealCandidate): string {
  if (typeof candidate.discount === 'number' && candidate.discount > 0) {
    return `，省 ${money(candidate.discount)}`;
  }
  return '';
}

/** 渲染推荐卡片（主推 + 理由 + 券后价 + 备选 + 提示） */
export function renderRecommendation(recommendation: Recommendation, notices: string[] = []): string {
  const primary = recommendation.primary;
  const lines: string[] = [];
  lines.push(`🍔 推荐：${primary.name}`);
  lines.push(`  券后价 ${money(primary.effectivePrice)}（原价 ${money(primary.price)}${discountNote(primary)}）`);
  if (primary.category) {
    lines.push(`  品类：${primary.category}`);
  }
  if (primary.nutrition?.energyKcal !== undefined) {
    lines.push(`  热量：约 ${primary.nutrition.energyKcal} kcal（仅供参考）`);
  }
  lines.push('  理由：');
  for (const reason of recommendation.reasons) {
    lines.push(`  ・${reason}`);
  }
  if (recommendation.alternatives.length > 0) {
    lines.push('备选：');
    for (const alternative of recommendation.alternatives) {
      lines.push(`  ・${alternative.name} — 券后 ${money(alternative.effectivePrice)}`);
    }
  }
  if (recommendation.bundle) {
    const bundle = recommendation.bundle;
    lines.push('凑单更省：');
    lines.push(
      `  ・再买「${bundle.addName}」${money(bundle.addPrice)}，凑满 ${money(bundle.threshold)} 可用「${bundle.couponText}」`,
    );
    lines.push(
      `  ・预计应付 ${money(bundle.bundlePay)}（比现在省 ${money(bundle.saved)}，多一份加购）（预计，以官方结算为准）`,
    );
  }
  for (const notice of notices) {
    lines.push(`提示：${notice}`);
  }
  return lines.join('\n');
}

/** 渲染提醒评估（提醒文案 + 可选宿主定时建议） */
export function renderReminder(evaluation: ReminderEvaluation): string {
  const lines = [evaluation.message];
  if (evaluation.schedule.available || evaluation.decision.status === 'trigger') {
    lines.push(evaluation.schedule.description);
  }
  return lines.filter((line) => line.length > 0).join('\n');
}

/** 渲染脱敏画像摘要 */
export function renderProfileSummary(summary: ProfileSummary): string {
  return [`📋 你的口味画像（已脱敏）`, summary.text].join('\n');
}

/** 渲染采集待问清单（onboarding，v1.1.0） */
export function renderOnboarding(plan: OnboardingPlan): string {
  if (plan.questions.length === 0) {
    return '📋 你的画像已足够，无需再补充信息，直接说“帮我推荐午餐”即可。';
  }
  const header = plan.coldStart
    ? '👋 先了解你几件事，之后的推荐会更懂你（都可以跳过）：'
    : '📋 还差几项信息，补全后推荐更准（可跳过）：';
  const lines = plan.questions.map((question, index) => {
    const required = question.required ? '【建议填写】' : '【可选】';
    const options = question.options ? `（可选：${question.options.join(' / ')}）` : '';
    return `${index + 1}. ${question.label} ${required}${options}\n   为什么问：${question.why}`;
  });
  return [header, ...lines].join('\n');
}

/** 渲染券列表 */
export function renderCoupons(coupons: CouponInfo[]): string {
  if (coupons.length === 0) {
    return '暂未发现可领取的券。';
  }
  return coupons
    .map((coupon, index) => {
      const name = coupon.name ?? coupon.couponCode ?? coupon.couponId ?? `券${index + 1}`;
      const discount = coupon.discount ? `（${coupon.discount}）` : '';
      return `・${name}${discount}`;
    })
    .join('\n');
}

/** 渲染宿主定时建议 */
export function renderSchedule(schedule: HostScheduleSuggestion): string {
  return schedule.description;
}

/** 按段落拼接文本（过滤空段） */
export function composeText(parts: Array<string | undefined>): string {
  return parts.filter((part): part is string => typeof part === 'string' && part.trim().length > 0).join('\n\n');
}
