import type { ToolResult } from '@/mcp-client/types';
import type { RecommendDeps } from '@/recommender/deps';
import type {
  CalculatePriceResult,
  CouponInfo,
  DeliveryAddress,
  MealDetail,
  MealItem,
  MealsQueryResult,
  NutritionFood,
  StoreInfo,
  UserProfile,
} from '@/types/index';

/** 测试用菜单 */
export const TEST_MEALS: Record<string, MealItem> = {
  M001: { code: 'M001', name: '巨无霸套餐', price: 39, category: '汉堡' },
  M002: { code: 'M002', name: '双层吉士堡套餐', price: 33, category: '汉堡' },
  M003: { code: 'M003', name: '麦辣鸡腿堡套餐', price: 35, category: '鸡类' },
  M004: { code: 'M004', name: '田园沙拉套餐', price: 25, category: '轻食' },
};

/** 测试用营养 */
export const TEST_NUTRITION: NutritionFood[] = [
  { productName: '巨无霸套餐', nutrition: { energyKcal: 590, protein: 27 } },
  { productName: '双层吉士堡套餐', nutrition: { energyKcal: 520, protein: 25 } },
  { productName: '麦辣鸡腿堡套餐', nutrition: { energyKcal: 560, protein: 24 } },
  { productName: '田园沙拉套餐', nutrition: { energyKcal: 300, protein: 12 } },
];

/** 测试用画像 */
export function testProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    version: 1,
    preferences: {
      categoryWeights: { 汉堡: 0.8, 轻食: 0.2 },
      priceBand: { min: 20, max: 40 },
    },
    frequent: { storeCodes: [], timeSlots: [] },
    history: [],
    updatedAt: '2026-10-10T00:00:00.000Z',
    ...overrides,
  };
}

function ok<T>(data: T, degraded = false): ToolResult<T> {
  return { data, degraded };
}

/** 依赖调用计数 */
export interface FakeCalls {
  queryMeals: number;
  queryMealDetail: number;
  calculatePrice: number;
  listNutritionFoods: number;
  availableCoupons: number;
  queryStoreCoupons: number;
  queryMyCoupons: number;
  queryNearbyStores: number;
  deliveryQueryAddresses: number;
  deliveryQueryStores: number;
  readProfile: number;
}

/** 创建假依赖（默认基于测试样例；可逐项覆盖） */
export function createFakeDeps(
  overrides: Partial<RecommendDeps> = {},
): { deps: RecommendDeps; calls: FakeCalls } {
  const calls: FakeCalls = {
    queryMeals: 0,
    queryMealDetail: 0,
    calculatePrice: 0,
    listNutritionFoods: 0,
    availableCoupons: 0,
    queryStoreCoupons: 0,
    queryMyCoupons: 0,
    queryNearbyStores: 0,
    deliveryQueryAddresses: 0,
    deliveryQueryStores: 0,
    readProfile: 0,
  };

  const store: StoreInfo = { storeCode: 'S1', beCode: '2', storeName: '测试店' };

  const defaults: RecommendDeps = {
    readProfile: async () => {
      calls.readProfile += 1;
      return testProfile();
    },
    queryMeals: async () => {
      calls.queryMeals += 1;
      const meals: MealsQueryResult = { meals: { ...TEST_MEALS } };
      return ok(meals);
    },
    queryMealDetail: async (q) => {
      calls.queryMealDetail += 1;
      const meal = TEST_MEALS[q.code];
      const detail: MealDetail = {
        code: q.code,
        name: meal?.name ?? '',
        ...(meal?.price !== undefined ? { price: meal.price } : {}),
      };
      return ok(detail);
    },
    listNutritionFoods: async () => {
      calls.listNutritionFoods += 1;
      return ok(TEST_NUTRITION.map((food) => ({ ...food })));
    },
    availableCoupons: async () => {
      calls.availableCoupons += 1;
      return ok<CouponInfo[]>([]);
    },
    queryStoreCoupons: async () => {
      calls.queryStoreCoupons += 1;
      return ok<CouponInfo[]>([{ couponId: 'C1', couponCode: 'SAVE8', name: '立减8', discount: '8' }]);
    },
    queryMyCoupons: async () => {
      calls.queryMyCoupons += 1;
      return ok<CouponInfo[]>([]);
    },
    calculatePrice: async (q) => {
      calls.calculatePrice += 1;
      const original = q.items.reduce(
        (sum, item) => sum + (TEST_MEALS[item.productCode]?.price ?? 0) * item.quantity,
        0,
      );
      const hasCoupon = q.items.some((item) => item.couponId || item.couponCode);
      const discount = hasCoupon ? 8 : 0;
      const result: CalculatePriceResult = {
        originalPrice: original,
        discount,
        price: Math.max(0, original - discount),
      };
      return ok(result);
    },
    queryNearbyStores: async () => {
      calls.queryNearbyStores += 1;
      return ok<StoreInfo[]>([store]);
    },
    deliveryQueryAddresses: async () => {
      calls.deliveryQueryAddresses += 1;
      const addresses: DeliveryAddress[] = [{ addressId: 'A1', fullAddress: '测试地址' }];
      return ok(addresses);
    },
    deliveryQueryStores: async () => {
      calls.deliveryQueryStores += 1;
      return ok<StoreInfo[]>([store]);
    },
  };

  return { deps: { ...defaults, ...overrides }, calls };
}
