/**
 * 凑单 / 券最大化加购建议（v1.2.0 设计 §2.4）。
 *
 * 思路：当主推**原价**距某张满减券门槛还差 `gap`（即该券尚未生效），且存在一件商品
 * 满足 `gap ≤ 价格 < 券面额`（加购价小于券面额 → **净省 > 0**），则建议加购该商品凑单。
 *
 * 关键：门槛判定必须基于**原价小计**（`primary.price`），而非券后价；否则会把"已生效的券"
 * 当作"未生效"重复计算，得出错误的省钱结论。已被主推使用的券（`excludeCoupon`）一并排除。
 *
 * 说明：券门槛由券文本**近似解析**；结果为**预计**，最终以官方结算为准；本模块**不发起** MCP 调用。
 */

import type { RecommenderConfig } from './config.js';
import type { BundleSuggestion, CouponInfo, MealCandidate } from '../types/index.js';

/** 满减券解析正则：满 X 减 Y */
const THRESHOLD_PATTERN = /满\s*(\d+(?:\.\d+)?)\s*减\s*(\d+(?:\.\d+)?)/;

/** 解析后的满减券 */
export interface ThresholdCoupon {
  threshold: number;
  amount: number;
  /** 券文案（用于展示） */
  text: string;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 券是否等价（couponId / couponCode / name 任一相同） */
function sameCoupon(a: CouponInfo, b: CouponInfo): boolean {
  return (
    (a.couponId !== undefined && a.couponId === b.couponId) ||
    (a.couponCode !== undefined && a.couponCode === b.couponCode) ||
    (a.name !== undefined && a.name === b.name)
  );
}

/** 从券的名称/面额文本解析「满 X 减 Y」；不可解析返回 undefined */
export function parseThresholdCoupon(coupon: CouponInfo): ThresholdCoupon | undefined {
  const text = [coupon.name, coupon.discount]
    .filter((item): item is string => typeof item === 'string' && item.length > 0)
    .join(' ');
  const match = THRESHOLD_PATTERN.exec(text);
  if (!match) {
    return undefined;
  }
  const threshold = Number(match[1]);
  const amount = Number(match[2]);
  if (!Number.isFinite(threshold) || !Number.isFinite(amount) || threshold <= 0 || amount <= 0) {
    return undefined;
  }
  return { threshold, amount, text: coupon.name ?? `满${threshold}减${amount}` };
}

/** `suggestBundle` 参数 */
export interface SuggestBundleParams {
  primary: MealCandidate;
  /** 全部可售候选（用于挑选加购项） */
  candidates: MealCandidate[];
  coupons: CouponInfo[];
  /** 已被主推使用的券（不得重复计入），v1.2.0 */
  excludeCoupon?: CouponInfo;
  config: RecommenderConfig;
}

/**
 * 生成凑单建议：仅当**净省 > 0** 时返回；否则返回 undefined（不打扰）。
 * 多张券命中时取净省最大者。
 */
export function suggestBundle(params: SuggestBundleParams): BundleSuggestion | undefined {
  const { primary, candidates, coupons, excludeCoupon, config } = params;
  const currentPay = primary.effectivePrice;
  // 门槛按**原价**判定：gap>0 才说明该券尚未对主推生效
  const base = primary.price;
  let best: BundleSuggestion | undefined;

  for (const coupon of coupons) {
    if (excludeCoupon && sameCoupon(coupon, excludeCoupon)) {
      continue;
    }
    const parsed = parseThresholdCoupon(coupon);
    if (!parsed) {
      continue;
    }
    const gap = round2(parsed.threshold - base);
    // 仅在门槛差在合理窗口、且加购价可 < 券面额（净省前提）时考虑
    if (gap <= 0 || gap > config.bundleMaxGap || gap >= parsed.amount) {
      continue;
    }
    const fillers = candidates
      .filter(
        (candidate) =>
          candidate.code !== primary.code &&
          candidate.price > 0 &&
          candidate.price >= gap &&
          candidate.price < parsed.amount,
      )
      .sort((a, b) => a.price - b.price);
    const filler = fillers[0];
    if (!filler) {
      continue;
    }
    const bundlePay = round2(currentPay + filler.price - parsed.amount);
    const saved = round2(currentPay - bundlePay);
    if (saved <= 0) {
      continue;
    }
    const suggestion: BundleSuggestion = {
      couponText: parsed.text,
      threshold: parsed.threshold,
      amount: parsed.amount,
      addCode: filler.code,
      addName: filler.name,
      addPrice: filler.price,
      currentPay,
      bundlePay,
      saved,
    };
    if (!best || suggestion.saved > best.saved) {
      best = suggestion;
    }
  }
  return best;
}
