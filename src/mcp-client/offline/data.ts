/**
 * 离线演示数据（技术设计 §1.2 / §3.2 / §5 / §6：离线可复现）。
 * 仅用于 `MCD_OFFLINE=1` 或实时 MCP 不可用时的降级，标注 `degraded=true`。
 * 数据为演示样例，非真实门店/价格/营养，输出需注明"仅供参考"。
 */

import type {
  CampaignInfo,
  CouponInfo,
  DeliveryAddress,
  MealItem,
  NutritionFood,
  StoreInfo,
} from '../../types/index.js';

/** 离线门店 */
export const OFFLINE_STORES: StoreInfo[] = [
  { storeCode: 'S1001', beCode: '2', storeName: '人民广场店', distance: 320, businessHours: '08:00-23:00' },
  { storeCode: 'S1002', beCode: '2', storeName: '南京东路店', distance: 860, businessHours: '07:30-22:30' },
];

/** 离线可配送地址 */
export const OFFLINE_ADDRESSES: DeliveryAddress[] = [
  { addressId: 'A001', contactName: '用户', fullAddress: '演示地址·送达点1' },
  { addressId: 'A002', contactName: '用户', fullAddress: '演示地址·送达点2' },
];

/** 离线可售套餐（含原价，元） */
export const OFFLINE_MEALS: MealItem[] = [
  { code: 'M001', name: '巨无霸套餐', price: 39, category: '汉堡' },
  { code: 'M002', name: '双层吉士堡套餐', price: 33, category: '汉堡' },
  { code: 'M003', name: '麦辣鸡腿堡套餐', price: 35, category: '汉堡' },
  { code: 'M004', name: '板烧鸡腿堡套餐', price: 36, category: '汉堡' },
  { code: 'M005', name: '麦香鸡套餐', price: 30, category: '汉堡' },
];

/** 离线营养（按 productName 与候选匹配） */
export const OFFLINE_NUTRITION: NutritionFood[] = [
  {
    productName: '巨无霸套餐',
    nutrition: { energyKcal: 590, protein: 27, fat: 30, carbohydrate: 47, sodium: 1010, calcium: 180 },
  },
  {
    productName: '双层吉士堡套餐',
    nutrition: { energyKcal: 520, protein: 25, fat: 26, carbohydrate: 42, sodium: 900, calcium: 210 },
  },
  {
    productName: '麦辣鸡腿堡套餐',
    nutrition: { energyKcal: 560, protein: 24, fat: 28, carbohydrate: 50, sodium: 1120, calcium: 150 },
  },
  {
    productName: '板烧鸡腿堡套餐',
    nutrition: { energyKcal: 500, protein: 26, fat: 20, carbohydrate: 45, sodium: 980, calcium: 160 },
  },
  {
    productName: '麦香鸡套餐',
    nutrition: { energyKcal: 460, protein: 20, fat: 18, carbohydrate: 40, sodium: 850, calcium: 140 },
  },
];

/** 离线券（只读演示） */
export const OFFLINE_COUPONS: CouponInfo[] = [
  { couponId: 'C901', couponCode: 'SAVE5', name: '满30减5', discount: '5', validTo: '2026-12-31' },
  { couponId: 'C902', couponCode: 'MEAL8', name: '套餐立减8', discount: '8', validTo: '2026-12-31' },
  { couponId: 'C903', couponCode: 'NEW10', name: '新客立减10', discount: '10', validTo: '2026-11-30' },
];

/** 离线活动 */
export const OFFLINE_CAMPAIGNS: CampaignInfo[] = [
  { name: '程序员节限定套餐', startDate: '2026-10-09', endDate: '2026-10-25', description: '限时优惠，仅供参考' },
];
