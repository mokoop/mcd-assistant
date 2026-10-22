/**
 * JSON 类工具返回的解析与校验（技术设计 §3.2：JSON 类 → zod 校验 + 类型推导）。
 * 解析失败抛 `AppError(PARSE_ERROR)`，由调用方决定「视为空结果并告警」或中断。
 */

import { z } from 'zod';

import { AppError, ErrorCode } from '../../core/errors.js';

import type {
  BoundCoupon,
  CalculatePriceResult,
  CouponInfo,
  DeliveryAddress,
  MealDetail,
  MealItem,
  MealsQueryResult,
  NowTimeInfo,
  StoreInfo,
} from '../../types/index.js';
import type { RawToolResult } from '../types.js';

const numLike = z.union([z.number(), z.string()]);
const idLike = z.union([z.string(), z.number()]);

/** 去除 ```json 代码围栏 */
function stripFence(text: string): string {
  return text
    .replace(/^\s*```[a-zA-Z]*\s*\n?/, '')
    .replace(/\n?```\s*$/, '')
    .trim();
}

/** 读取 JSON 值：优先使用 structuredContent，否则解析文本；失败抛 PARSE_ERROR */
export function readJsonValue(raw: RawToolResult): unknown {
  if (raw.structured !== undefined) {
    return raw.structured;
  }
  const text = stripFence(raw.text);
  if (text.length === 0) {
    throw new AppError({ code: ErrorCode.PARSE_ERROR, message: '返回内容为空，无法解析 JSON' });
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new AppError({ code: ErrorCode.PARSE_ERROR, message: 'JSON 解析失败', cause: error });
  }
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function toStringId(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** 定位数组：根数组，或对象下已知键中的数组 */
function locateArray(value: unknown, keys: string[]): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  const record = asRecord(value);
  if (record) {
    for (const key of keys) {
      if (Array.isArray(record[key])) {
        return record[key] as unknown[];
      }
    }
    for (const nested of Object.values(record)) {
      if (Array.isArray(nested)) {
        return nested;
      }
    }
  }
  return [];
}

/** 定位对象：根对象，或对象下已知键中的对象 */
function locateRecord(value: unknown, keys: string[]): Record<string, unknown> | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  for (const key of keys) {
    const nested = asRecord(record[key]);
    if (nested) {
      return nested;
    }
  }
  return record;
}

// ── now-time-info ───────────────────────────────────────────────────────────

const nowTimeInfoSchema = z
  .object({
    datetime: z.union([z.string(), z.number()]).optional(),
    date: z.string().optional(),
    dayOfWeek: numLike.optional(),
    timezone: z.string().optional(),
    offset: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

/** 解析 `now-time-info`（关键工具，缺失 datetime 抛 PARSE_ERROR） */
export function parseNowTimeInfo(raw: RawToolResult): NowTimeInfo {
  const record = locateRecord(readJsonValue(raw), ['data', 'result', 'time', 'now', 'info']);
  if (!record) {
    throw new AppError({ code: ErrorCode.PARSE_ERROR, message: 'now-time-info 返回结构无效' });
  }
  const parsed = nowTimeInfoSchema.safeParse(record);
  if (!parsed.success) {
    throw new AppError({ code: ErrorCode.PARSE_ERROR, message: 'now-time-info 字段校验失败', cause: parsed.error });
  }
  const data = parsed.data;
  const datetime = typeof data.datetime === 'number' ? new Date(data.datetime).toISOString() : data.datetime;
  if (!datetime || datetime.trim().length === 0) {
    throw new AppError({ code: ErrorCode.PARSE_ERROR, message: 'now-time-info 缺少 datetime' });
  }
  const date = data.date ?? datetime.slice(0, 10);
  const dayOfWeek = toNumber(data.dayOfWeek) ?? new Date(datetime).getDay() ?? 0;
  const timezone = data.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const offset = data.offset !== undefined ? String(data.offset) : '';
  return { datetime, date, dayOfWeek, timezone, offset };
}

// ── 门店 / 地址 ─────────────────────────────────────────────────────────────

const storeSchema = z
  .object({
    storeCode: idLike.optional(),
    storeId: idLike.optional(),
    code: idLike.optional(),
    beCode: idLike.optional(),
    storeName: z.string().optional(),
    name: z.string().optional(),
    distance: numLike.optional(),
    businessHours: z.string().optional(),
  })
  .passthrough();

/** 解析门店列表 */
export function parseStores(raw: RawToolResult): StoreInfo[] {
  const items = locateArray(readJsonValue(raw), ['stores', 'list', 'data', 'items', 'result']);
  const stores: StoreInfo[] = [];
  for (const item of items) {
    const parsed = storeSchema.safeParse(item);
    if (!parsed.success) {
      continue;
    }
    const code = toStringId(parsed.data.storeCode) ?? toStringId(parsed.data.storeId) ?? toStringId(parsed.data.code);
    if (!code) {
      continue;
    }
    const store: StoreInfo = { storeCode: code };
    const beCode = toStringId(parsed.data.beCode);
    const storeName = parsed.data.storeName ?? parsed.data.name;
    const distance = toNumber(parsed.data.distance);
    if (beCode) store.beCode = beCode;
    if (storeName) store.storeName = storeName;
    if (distance !== undefined) store.distance = distance;
    if (parsed.data.businessHours) store.businessHours = parsed.data.businessHours;
    stores.push(store);
  }
  return stores;
}

const addressSchema = z
  .object({
    addressId: idLike.optional(),
    id: idLike.optional(),
    contactName: z.string().optional(),
    fullAddress: z.string().optional(),
    address: z.string().optional(),
  })
  .passthrough();

/** 解析可配送地址列表 */
export function parseAddresses(raw: RawToolResult): DeliveryAddress[] {
  const items = locateArray(readJsonValue(raw), ['addresses', 'list', 'data', 'items', 'result']);
  const addresses: DeliveryAddress[] = [];
  for (const item of items) {
    const parsed = addressSchema.safeParse(item);
    if (!parsed.success) {
      continue;
    }
    const id = toStringId(parsed.data.addressId) ?? toStringId(parsed.data.id);
    if (!id) {
      continue;
    }
    const address: DeliveryAddress = { addressId: id };
    if (parsed.data.contactName) address.contactName = parsed.data.contactName;
    const full = parsed.data.fullAddress ?? parsed.data.address;
    if (full) address.fullAddress = full;
    addresses.push(address);
  }
  return addresses;
}

// ── 菜单 / 详情 ─────────────────────────────────────────────────────────────

const mealSchema = z
  .object({
    code: idLike.optional(),
    mealCode: idLike.optional(),
    productCode: idLike.optional(),
    name: z.string().optional(),
    mealName: z.string().optional(),
    price: numLike.optional(),
    category: z.string().optional(),
    categoryName: z.string().optional(),
    imageUrl: z.string().optional(),
  })
  .passthrough();

function toMealItem(code: string, value: unknown): MealItem | undefined {
  const parsed = mealSchema.safeParse(value);
  if (!parsed.success) {
    return undefined;
  }
  const name = parsed.data.name ?? parsed.data.mealName;
  if (!name) {
    return undefined;
  }
  const item: MealItem = { code, name };
  const price = toNumber(parsed.data.price);
  const category = parsed.data.category ?? parsed.data.categoryName;
  if (price !== undefined) item.price = price;
  if (category) item.category = category;
  if (parsed.data.imageUrl) item.imageUrl = parsed.data.imageUrl;
  return item;
}

/** 解析 `query-meals`（`meals` map 结构；兼容数组形态） */
export function parseMeals(raw: RawToolResult): MealsQueryResult {
  const value = readJsonValue(raw);
  const record = asRecord(value) ?? {};
  const mealsSource = asRecord(record.meals) ?? asRecord(asRecord(record.data)?.meals);

  const meals: Record<string, MealItem> = {};
  if (mealsSource) {
    for (const [key, item] of Object.entries(mealsSource)) {
      const meal = toMealItem(key, item);
      if (meal) {
        meals[key] = meal;
      }
    }
  } else {
    // 兼容：数组形态，code 取自条目自身
    for (const item of locateArray(value, ['meals', 'list', 'data', 'items'])) {
      const parsed = mealSchema.safeParse(item);
      if (!parsed.success) {
        continue;
      }
      const code = toStringId(parsed.data.code) ?? toStringId(parsed.data.mealCode) ?? toStringId(parsed.data.productCode);
      if (!code) {
        continue;
      }
      const meal = toMealItem(code, item);
      if (meal) {
        meals[code] = meal;
      }
    }
  }

  const frequent = Array.isArray(record.frequent)
    ? (record.frequent as unknown[]).filter((item): item is string => typeof item === 'string')
    : undefined;
  const categories = Array.isArray(record.categories)
    ? (record.categories as unknown[])
        .map((item) => {
          const cat = asRecord(item);
          const code = cat ? toStringId(cat.code) : undefined;
          const name = cat?.name;
          return code && typeof name === 'string' ? { code, name } : undefined;
        })
        .filter((item): item is { code: string; name: string } => item !== undefined)
    : undefined;

  return {
    meals,
    ...(frequent ? { frequent } : {}),
    ...(categories && categories.length > 0 ? { categories } : {}),
  };
}

/** 解析 `query-meal-detail` */
export function parseMealDetail(raw: RawToolResult): MealDetail {
  const record = locateRecord(readJsonValue(raw), ['data', 'result', 'meal', 'detail']);
  if (!record) {
    throw new AppError({ code: ErrorCode.PARSE_ERROR, message: 'query-meal-detail 返回结构无效' });
  }
  const parsed = mealSchema.safeParse(record);
  if (!parsed.success) {
    throw new AppError({ code: ErrorCode.PARSE_ERROR, message: 'query-meal-detail 字段校验失败', cause: parsed.error });
  }
  const name = parsed.data.name ?? parsed.data.mealName;
  if (!name) {
    throw new AppError({ code: ErrorCode.PARSE_ERROR, message: 'query-meal-detail 缺少套餐名称' });
  }
  const code =
    toStringId(parsed.data.code) ?? toStringId(parsed.data.mealCode) ?? toStringId(parsed.data.productCode) ?? '';
  const detail: MealDetail = { code, name };
  const price = toNumber(parsed.data.price);
  if (price !== undefined) detail.price = price;
  if (parsed.data.imageUrl) detail.imageUrl = parsed.data.imageUrl;
  if ('modification' in record) detail.modification = record.modification;
  if (typeof record.supportModify === 'boolean') detail.supportModify = record.supportModify;
  return detail;
}

// ── 券 ──────────────────────────────────────────────────────────────────────

const couponSchema = z
  .object({
    couponId: idLike.optional(),
    couponCode: idLike.optional(),
    id: idLike.optional(),
    code: idLike.optional(),
    name: z.string().optional(),
    title: z.string().optional(),
    discount: z.union([z.string(), z.number()]).optional(),
    validFrom: z.string().optional(),
    validTo: z.string().optional(),
  })
  .passthrough();

/** 解析 `query-store-coupons`（JSON 类券列表） */
export function parseStoreCoupons(raw: RawToolResult): CouponInfo[] {
  const items = locateArray(readJsonValue(raw), ['coupons', 'list', 'data', 'items', 'result']);
  const coupons: CouponInfo[] = [];
  for (const item of items) {
    const parsed = couponSchema.safeParse(item);
    if (!parsed.success) {
      continue;
    }
    const coupon: CouponInfo = {};
    const couponId = toStringId(parsed.data.couponId) ?? toStringId(parsed.data.id);
    const couponCode = toStringId(parsed.data.couponCode) ?? toStringId(parsed.data.code);
    const name = parsed.data.name ?? parsed.data.title;
    if (couponId) coupon.couponId = couponId;
    if (couponCode) coupon.couponCode = couponCode;
    if (name) coupon.name = name;
    if (parsed.data.discount !== undefined) coupon.discount = String(parsed.data.discount);
    if (parsed.data.validFrom) coupon.validFrom = parsed.data.validFrom;
    if (parsed.data.validTo) coupon.validTo = parsed.data.validTo;
    if (Object.keys(coupon).length > 0) {
      coupons.push(coupon);
    }
  }
  return coupons;
}

// ── 价格试算 ────────────────────────────────────────────────────────────────

const priceSchema = z
  .object({
    originalPrice: numLike.optional(),
    discount: numLike.optional(),
    price: numLike.optional(),
    productList: z.array(z.unknown()).optional(),
  })
  .passthrough();

/** 解析 `calculate-price` */
export function parseCalculatePrice(raw: RawToolResult): CalculatePriceResult {
  const record = locateRecord(readJsonValue(raw), ['data', 'result', 'price']);
  if (!record) {
    throw new AppError({ code: ErrorCode.PARSE_ERROR, message: 'calculate-price 返回结构无效' });
  }
  const parsed = priceSchema.safeParse(record);
  if (!parsed.success) {
    throw new AppError({ code: ErrorCode.PARSE_ERROR, message: 'calculate-price 字段校验失败', cause: parsed.error });
  }
  const price = toNumber(parsed.data.price);
  if (price === undefined) {
    throw new AppError({ code: ErrorCode.PARSE_ERROR, message: 'calculate-price 缺少 price' });
  }
  const originalPrice = toNumber(parsed.data.originalPrice) ?? price;
  const discount = toNumber(parsed.data.discount) ?? Math.max(0, originalPrice - price);
  const result: CalculatePriceResult = { originalPrice, discount, price };
  if (parsed.data.productList) {
    result.productList = parsed.data.productList;
  }
  return result;
}

// ── 领券（写操作） ──────────────────────────────────────────────────────────

const boundCouponSchema = z
  .object({
    couponId: idLike.optional(),
    couponCode: idLike.optional(),
    id: idLike.optional(),
  })
  .passthrough();

/** 解析 `auto-bind-coupons`（写操作返回） */
export function parseBoundCoupons(raw: RawToolResult): BoundCoupon[] {
  const items = locateArray(readJsonValue(raw), ['coupons', 'list', 'data', 'items', 'result']);
  const bound: BoundCoupon[] = [];
  for (const item of items) {
    const parsed = boundCouponSchema.safeParse(item);
    if (!parsed.success) {
      continue;
    }
    const couponId = toStringId(parsed.data.couponId) ?? toStringId(parsed.data.id);
    if (!couponId) {
      continue;
    }
    const entry: BoundCoupon = { couponId };
    const couponCode = toStringId(parsed.data.couponCode);
    if (couponCode) entry.couponCode = couponCode;
    bound.push(entry);
  }
  return bound;
}
