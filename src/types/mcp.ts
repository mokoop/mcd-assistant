/**
 * mcd-mcp 工具返回值的最小类型（对应技术设计 §3.1）
 *
 * 说明：此处仅声明业务层实际消费的最小字段集，避免耦合官方完整 Schema；
 * 外部返回在 mcp-client 层经 zod 校验后再收窄为本类型。
 */

import type { NutritionInfo } from './recommendation.js';

/** `now-time-info` 返回 */
export interface NowTimeInfo {
  /** ISO8601 或 'YYYY-MM-DD HH:mm:ss' */
  datetime: string;
  /** 'YYYY-MM-DD' */
  date: string;
  /** 0-6（周日=0） */
  dayOfWeek: number;
  timezone: string;
  offset: string;
}

/** 门店信息（附近门店 / 可配送门店共用） */
export interface StoreInfo {
  storeCode: string;
  beCode?: string;
  storeName?: string;
  /** 距离（米） */
  distance?: number;
  businessHours?: string;
}

/** 可配送地址（`delivery-query-addresses` 返回项） */
export interface DeliveryAddress {
  addressId: string;
  contactName?: string;
  fullAddress?: string;
}

/** 餐品/套餐摘要（`query-meals` 中的条目） */
export interface MealItem {
  code: string;
  name: string;
  price?: number;
  category?: string;
  imageUrl?: string;
}

/** `query-meals` 返回（`meals` 为 map 结构） */
export interface MealsQueryResult {
  frequent?: string[];
  categories?: Array<{ code: string; name: string }>;
  meals: Record<string, MealItem>;
}

/** `query-meal-detail` 返回 */
export interface MealDetail {
  code: string;
  name: string;
  price?: number;
  imageUrl?: string;
  /** 套餐内替换/特制信息（本期仅读取） */
  modification?: unknown;
  supportModify?: boolean;
}

/** 券信息（`available-coupons` / `query-store-coupons` / `query-my-coupons` 抽取后的统一结构） */
export interface CouponInfo {
  couponId?: string;
  couponCode?: string;
  name?: string;
  /** 面额或折扣描述 */
  discount?: string;
  validFrom?: string;
  validTo?: string;
}

/** `calculate-price` 返回 */
export interface CalculatePriceResult {
  originalPrice: number;
  discount: number;
  price: number;
  productList?: unknown[];
}

/** `list-nutrition-foods`（TOON）解析后的单条营养记录（按 productName 与候选匹配） */
export interface NutritionFood {
  productName: string;
  nutrition: NutritionInfo;
}

/** `campaign-calendar`（Markdown）解析后的活动条目 */
export interface CampaignInfo {
  name: string;
  startDate?: string;
  endDate?: string;
  description?: string;
}

/** `auto-bind-coupons`（写操作）领取结果 */
export interface BoundCoupon {
  couponId: string;
  couponCode?: string;
}
