/**
 * mcp-client 内部类型：工具入参、统一返回包装、可注入传输接口、离线数据源接口。
 */

import type {
  BoundCoupon,
  CalculatePriceResult,
  CampaignInfo,
  CouponInfo,
  DeliveryAddress,
  MealDetail,
  MealsQueryResult,
  NowTimeInfo,
  NutritionFood,
  StoreInfo,
} from '../types/index.js';

/** 工具调用统一返回：`degraded` 表示本次结果来自离线降级（非实时 MCP） */
export interface ToolResult<T> {
  data: T;
  degraded: boolean;
}

/** 原始工具返回（由传输层归一） */
export interface RawToolResult {
  /** 文本内容（多段 text 以换行拼接） */
  text: string;
  /** 结构化内容（若服务端提供 structuredContent） */
  structured?: Record<string, unknown>;
  /** 服务端标记的工具执行错误 */
  isError?: boolean;
}

/** 可注入传输接口（默认真实 SDK 实现，测试注入假实现） */
export interface ToolTransport {
  callTool(name: string, args: Record<string, unknown>): Promise<RawToolResult>;
  close(): Promise<void>;
}

// ── 工具入参 ────────────────────────────────────────────────────────────────

/** `query-nearby-stores` 入参 */
export interface NearbyStoresQuery {
  /** 1=距离 2=关键字 3=地图 */
  searchType?: 1 | 2 | 3;
  /** 1=到店 5=其他 */
  beType?: 1 | 5;
  city?: string;
  keyword?: string;
  latitude?: number;
  longitude?: number;
}

/** `delivery-query-stores` 入参 */
export interface DeliveryStoresQuery {
  addressId: string;
  beType?: 2;
}

/** 门店/菜单相关通用入参 */
export interface StoreMenuQuery {
  storeCode: string;
  beCode: string;
  /** 1=到店 2=麦乐送 */
  orderType: 1 | 2;
  beType: number;
  reservationDate?: string;
}

/** `query-meal-detail` 入参 */
export interface MealDetailQuery extends StoreMenuQuery {
  code: string;
}

/** `query-store-coupons` 入参 */
export interface StoreCouponsQuery {
  storeCode: string;
  beCode: string;
  orderType: 1 | 2;
  beType: number;
  reservationDate?: string;
}

/** `calculate-price` 单项入参 */
export interface PriceItem {
  productCode: string;
  quantity: number;
  couponId?: string;
  couponCode?: string;
}

/** `calculate-price` 入参 */
export interface CalculatePriceQuery {
  storeCode: string;
  beCode: string;
  orderType: 1 | 2;
  beType: number;
  items: PriceItem[];
  reservationDate?: string;
}

/** `campaign-calendar` 入参 */
export interface CampaignCalendarQuery {
  specifiedDate?: string;
}

// ── 离线数据源 ──────────────────────────────────────────────────────────────

/** 离线降级数据源（MCD_OFFLINE=1 或实时不可用时使用） */
export interface OfflineProvider {
  nowTimeInfo(): NowTimeInfo;
  queryNearbyStores(query: NearbyStoresQuery): StoreInfo[];
  deliveryQueryAddresses(): DeliveryAddress[];
  deliveryQueryStores(query: DeliveryStoresQuery): StoreInfo[];
  queryMeals(query: StoreMenuQuery): MealsQueryResult;
  queryMealDetail(query: MealDetailQuery): MealDetail;
  listNutritionFoods(): NutritionFood[];
  availableCoupons(): CouponInfo[];
  queryStoreCoupons(query: StoreCouponsQuery): CouponInfo[];
  queryMyCoupons(): CouponInfo[];
  calculatePrice(query: CalculatePriceQuery): CalculatePriceResult;
  campaignCalendar(query: CampaignCalendarQuery): CampaignInfo[];
  autoBindCoupons(): BoundCoupon[];
}
