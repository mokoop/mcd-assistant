/**
 * recommender 依赖注入面：默认绑定真实 mcp-client / profile，测试可注入假实现（零网络/零 IO）。
 */

import {
  availableCoupons,
  calculatePrice,
  deliveryQueryAddresses,
  deliveryQueryStores,
  listNutritionFoods,
  queryMealDetail,
  queryMeals,
  queryMyCoupons,
  queryNearbyStores,
  queryStoreCoupons,
} from '../mcp-client/index.js';
import { readProfile } from '../profile/index.js';

import type { UserProfile } from '../types/index.js';

/** recommender 依赖（函数签名与 mcp-client / profile 一致） */
export interface RecommendDeps {
  readProfile: () => Promise<UserProfile>;
  queryMeals: typeof queryMeals;
  queryMealDetail: typeof queryMealDetail;
  listNutritionFoods: typeof listNutritionFoods;
  availableCoupons: typeof availableCoupons;
  queryStoreCoupons: typeof queryStoreCoupons;
  queryMyCoupons: typeof queryMyCoupons;
  calculatePrice: typeof calculatePrice;
  queryNearbyStores: typeof queryNearbyStores;
  deliveryQueryAddresses: typeof deliveryQueryAddresses;
  deliveryQueryStores: typeof deliveryQueryStores;
}

/** 默认依赖（绑定真实实现） */
export const defaultRecommendDeps: RecommendDeps = {
  readProfile: () => readProfile(),
  queryMeals,
  queryMealDetail,
  listNutritionFoods,
  availableCoupons,
  queryStoreCoupons,
  queryMyCoupons,
  calculatePrice,
  queryNearbyStores,
  deliveryQueryAddresses,
  deliveryQueryStores,
};
