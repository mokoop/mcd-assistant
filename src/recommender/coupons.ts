/**
 * 券后最优（技术设计 §4.2 步骤 5）：
 * 汇集只读券（available / store / my），对 Top-K 候选逐项试算，单次推荐试算次数 ≤ M。
 * 互斥/不可叠加**以 `calculate-price` 实际返回为准**，不做本地叠加推断。
 */

import { logger } from '../core/logger.js';

import { channelOrderParams } from './store-strategy.js';

import type { RecommenderConfig } from './config.js';
import type { RecommendDeps } from './deps.js';
import type { Channel } from './store-strategy.js';
import type { CalculatePriceQuery, PriceItem } from '../mcp-client/types.js';
import type { CouponInfo, MealCandidate, StoreInfo } from '../types/index.js';

/** 券去重（以 couponId → couponCode → name 为键，保留首个） */
export function dedupeCoupons(coupons: CouponInfo[]): CouponInfo[] {
  const seen = new Set<string>();
  const result: CouponInfo[] = [];
  for (const coupon of coupons) {
    const key = coupon.couponId ?? coupon.couponCode ?? coupon.name;
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(coupon);
  }
  return result;
}

/**
 * 解析券面额数值（无法解析返回 0）。
 *
 * 简化与风险（评审 R8）：仅按数字解析，等价于把券都当作"立减/满减"面额；
 * 对折扣型券（如「5折」「8折」）会把折扣数误当作面额金额。
 * 该值**仅用于挑选试算券**，最终优惠一律以 `calculate-price` 实际试算为准，故不影响正确性。
 */
export function couponValue(coupon: CouponInfo): number {
  if (!coupon.discount) {
    return 0;
  }
  const value = Number(coupon.discount.replace(/[^\d.]/g, ''));
  return Number.isFinite(value) ? value : 0;
}

/** 挑选面额最大的券（无券返回 undefined）；命中与否以实际试算为准 */
export function pickBestCoupon(coupons: CouponInfo[]): CouponInfo | undefined {
  if (coupons.length === 0) {
    return undefined;
  }
  return coupons.reduce((best, coupon) => (couponValue(coupon) > couponValue(best) ? coupon : best));
}

/** 券后试算参数 */
export interface CouponPricingParams {
  deps: RecommendDeps;
  store: StoreInfo;
  channel: Channel;
  topCandidates: MealCandidate[];
  config: RecommenderConfig;
}

/** 券后试算结果 */
export interface CouponPricingResult {
  degraded: boolean;
  /** 实际发生的试算次数（≤ config.maxTrials） */
  trials: number;
  coupons: CouponInfo[];
  /** 实际用于试算的券（若有），供凑单建议排除以免重复计入（v1.2.0） */
  appliedCoupon?: CouponInfo;
}

function buildQuery(store: StoreInfo, channel: Channel, items: PriceItem[]): CalculatePriceQuery {
  const { orderType, beType } = channelOrderParams(channel);
  return { storeCode: store.storeCode, beCode: store.beCode ?? '2', orderType, beType, items };
}

/** 对 Top-K 候选择券试算，写回 `effectivePrice`/`discount` */
export async function applyCouponPricing(params: CouponPricingParams): Promise<CouponPricingResult> {
  const { deps, store, channel, topCandidates, config } = params;
  const { orderType, beType } = channelOrderParams(channel);
  const beCode = store.beCode ?? '2';

  const [available, storeCoupons, myCoupons] = await Promise.all([
    deps.availableCoupons(),
    deps.queryStoreCoupons({ storeCode: store.storeCode, beCode, orderType, beType }),
    deps.queryMyCoupons(),
  ]);

  const degraded = available.degraded || storeCoupons.degraded || myCoupons.degraded;
  const coupons = dedupeCoupons([...available.data, ...storeCoupons.data, ...myCoupons.data]);

  let trials = 0;
  let appliedCoupon: CouponInfo | undefined;
  if (coupons.length > 0) {
    const coupon = pickBestCoupon(coupons);
    for (const candidate of topCandidates) {
      if (trials >= config.maxTrials) {
        break;
      }
      // 简化（评审 R4）：每个候选统一使用同一张"面额最大"的券；
      // 券的适用性/互斥/叠加一律以 calculate-price 实际返回为准（设计允许"以实际试算为准"），此处不做本地判定。
      const item: PriceItem = {
        productCode: candidate.code,
        quantity: 1,
        ...(coupon?.couponId ? { couponId: coupon.couponId } : {}),
        ...(coupon?.couponCode ? { couponCode: coupon.couponCode } : {}),
      };
      try {
        const result = await deps.calculatePrice(buildQuery(store, channel, [item]));
        trials += 1;
        const price = result.data.price;
        if (Number.isFinite(price) && price >= 0 && price <= candidate.price + 0.001) {
          candidate.effectivePrice = price;
          candidate.discount = Math.round((candidate.price - price) * 100) / 100;
          // 仅当该券**确实产生优惠**时才视为"已使用"（避免把未生效的券误判为已用；v1.2.0 评审 B1）
          if (candidate.discount > 0) {
            appliedCoupon = coupon;
          }
        }
      } catch (error) {
        trials += 1;
        logger.warn('价格试算失败，保留原价', { code: candidate.code, error: String(error) });
      }
    }
  }

  return { degraded, trials, coupons, ...(appliedCoupon ? { appliedCoupon } : {}) };
}
