/**
 * 用户偏好画像相关类型（对应技术设计 §2.1）
 */

/** 就餐餐次 */
export type MealType = 'lunch' | 'dinner';

/** 选择来源：explicit=用户明确选择（强权重）；recommended=未明确选择/采纳推荐（弱权重，作起始画像）；rejected=负反馈（拒绝） */
export type ChoiceSource = 'explicit' | 'recommended' | 'rejected';

/** 取餐方式：delivery=麦乐送；nearby=附近门店（到店） */
export type DiningChannel = 'delivery' | 'nearby';

/** 口味偏好（标签 + 可选辣度） */
export interface TastePreference {
  /** 口味标签（如 '辣' / '清淡' / '甜' / '鸡' / '牛' / '鱼'） */
  tags: string[];
  /** 辣度偏好 0(不辣)~3(重辣)，可选 */
  spicyLevel?: number;
}

/**
 * 位置 / 取餐方式（仅存必要信息）。
 * 安全约束：只存城市名 / 门店码 / 配送地址 ID，**不存**完整地址与联系人（需求 §6.3 / §7）。
 */
export interface UserLocation {
  city?: string;
  defaultStoreCode?: string;
  defaultAddressId?: string;
  channel?: DiningChannel;
}

/** 饮食禁忌 / 过敏原（v1.2.0，近似关键词筛选，非官方成分数据） */
export interface DietaryPreference {
  /** 忌口标签 */
  avoid: string[];
  /** 过敏原标签 */
  allergies: string[];
}

/** 可接受价格带（元） */
export interface PriceBand {
  min: number;
  max: number;
}

/** 营养目标（可选约束） */
export interface NutritionGoal {
  /** 单餐热量上限（kcal） */
  maxKcal?: number;
  /** 蛋白质下限（g） */
  minProtein?: number;
}

/** 单次选择记录（保留最近 N 条，N=50） */
export interface ChoiceRecord {
  /** ISO8601 时间戳 */
  timestamp: string;
  storeCode: string;
  mealCode: string;
  mealName: string;
  /** 券后价（元） */
  effectivePrice: number;
  category?: string;
  /** 决策来源 */
  source: ChoiceSource;
}

/** 画像偏好项 */
export interface UserPreferences {
  /** 品类/口味偏好权重（0~1，归一化） */
  categoryWeights: Record<string, number>;
  /** 可接受价格带（元） */
  priceBand: PriceBand;
  /** 营养目标 */
  nutritionGoal?: NutritionGoal;
  /** 餐次偏好权重 */
  mealTypePreference?: Record<MealType, number>;
  /** 口味偏好（标签 + 辣度），v1.1.0 新增 */
  taste?: TastePreference;
  /** 饮食禁忌 / 过敏原，v1.2.0 新增 */
  dietary?: DietaryPreference;
}

/** 用户偏好画像 */
export interface UserProfile {
  /** 结构版本，便于迁移 */
  version: number;
  preferences: UserPreferences;
  /** 位置 / 取餐方式（v1.1.0 新增） */
  location?: UserLocation;
  /** 常点门店/时段 */
  frequent: {
    storeCodes: string[];
    timeSlots: string[];
  };
  /** 最近选择（保留最近 N 条，N=50） */
  history: ChoiceRecord[];
  /** ISO8601 */
  updatedAt: string;
}
