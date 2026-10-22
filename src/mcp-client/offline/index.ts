/**
 * 离线降级数据源实现（技术设计 §5 / §6）：`MCD_OFFLINE=1` 或实时不可用时使用。
 */

import {
  OFFLINE_ADDRESSES,
  OFFLINE_CAMPAIGNS,
  OFFLINE_COUPONS,
  OFFLINE_MEALS,
  OFFLINE_NUTRITION,
  OFFLINE_STORES,
} from './data.js';

import type { BoundCoupon, CalculatePriceResult, NowTimeInfo } from '../../types/index.js';
import type {
  CalculatePriceQuery,
  MealDetailQuery,
  OfflineProvider,
} from '../types.js';

function offsetString(date: Date): string {
  const minutes = -date.getTimezoneOffset();
  const sign = minutes >= 0 ? '+' : '-';
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${sign}${hh}:${mm}`;
}

function localNowTimeInfo(): NowTimeInfo {
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return {
    datetime: now.toISOString(),
    date,
    dayOfWeek: now.getDay(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    offset: offsetString(now),
  };
}

function couponValue(couponId: string | undefined, couponCode: string | undefined): number {
  if (!couponId && !couponCode) {
    return 0;
  }
  const matched = OFFLINE_COUPONS.find(
    (coupon) => coupon.couponId === couponId || (couponCode !== undefined && coupon.couponCode === couponCode),
  );
  const value = matched?.discount ? Number(matched.discount) : NaN;
  return Number.isFinite(value) ? value : 0;
}

/** 离线价格试算：按样例单价求和，命中券则扣减（不叠加，取最大单券优惠） */
function offlineCalculatePrice(query: CalculatePriceQuery): CalculatePriceResult {
  const priceByCode = new Map(OFFLINE_MEALS.map((meal) => [meal.code, meal.price ?? 0]));
  const unitPrices = new Map(OFFLINE_MEALS.map((meal) => [meal.code, meal.price ?? 0]));

  const originalPrice = query.items.reduce((sum, item) => {
    const unit = unitPrices.get(item.productCode) ?? priceByCode.get(item.productCode) ?? 0;
    return sum + unit * item.quantity;
  }, 0);

  const discount = query.items.reduce(
    (max, item) => Math.max(max, couponValue(item.couponId, item.couponCode)),
    0,
  );
  const price = Math.max(0, Math.round((originalPrice - discount) * 100) / 100);
  return { originalPrice, discount, price };
}

/** 创建离线降级数据源 */
export function createOfflineProvider(): OfflineProvider {
  return {
    nowTimeInfo: localNowTimeInfo,
    queryNearbyStores: () => OFFLINE_STORES.map((store) => ({ ...store })),
    deliveryQueryAddresses: () => OFFLINE_ADDRESSES.map((address) => ({ ...address })),
    deliveryQueryStores: () => OFFLINE_STORES.map((store) => ({ ...store })),
    queryMeals: () => ({ meals: Object.fromEntries(OFFLINE_MEALS.map((meal) => [meal.code, { ...meal }])) }),
    queryMealDetail: (query: MealDetailQuery) => {
      const meal = OFFLINE_MEALS.find((item) => item.code === query.code) ?? OFFLINE_MEALS[0];
      return {
        code: meal.code,
        name: meal.name,
        ...(meal.price !== undefined ? { price: meal.price } : {}),
        supportModify: false,
      };
    },
    listNutritionFoods: () => OFFLINE_NUTRITION.map((food) => ({ ...food })),
    availableCoupons: () => OFFLINE_COUPONS.map((coupon) => ({ ...coupon })),
    queryStoreCoupons: () => OFFLINE_COUPONS.map((coupon) => ({ ...coupon })),
    queryMyCoupons: () => OFFLINE_COUPONS.slice(0, 2).map((coupon) => ({ ...coupon })),
    calculatePrice: offlineCalculatePrice,
    campaignCalendar: () => OFFLINE_CAMPAIGNS.map((campaign) => ({ ...campaign })),
    autoBindCoupons: (): BoundCoupon[] =>
      OFFLINE_COUPONS.slice(0, 2).map((coupon) => ({ couponId: coupon.couponId ?? '', ...(coupon.couponCode ? { couponCode: coupon.couponCode } : {}) })),
  };
}
