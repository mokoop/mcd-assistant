/**
 * 推荐结果相关类型（对应技术设计 §2.1）
 */

/** 营养信息（缺失项代表数据不可用） */
export interface NutritionInfo {
  energyKcal?: number;
  protein?: number;
  fat?: number;
  carbohydrate?: number;
  sodium?: number;
  calcium?: number;
}

/** 候选套餐 */
export interface MealCandidate {
  code: string;
  name: string;
  category?: string;
  /** 原价（元） */
  price: number;
  /** 券后价（元） */
  effectivePrice: number;
  /** 优惠金额（元） */
  discount?: number;
  nutrition?: NutritionInfo;
  /** 口味标签（由 taste.inferTasteTags 近似推断，v1.1.0） */
  tasteTags?: string[];
  /** 热销信号：1=门店热销命中，0.5=未知，0=非热销（v1.1.0） */
  popularity?: number;
  score: number;
  /** 各维度得分（可解释） */
  breakdown: Record<string, number>;
}

/** 推荐场景（v1.1.0）：auto=按时间自动判定 */
export type Scene = 'auto' | 'quick' | 'save' | 'fit' | 'treat' | 'late';

/** 凑单/券最大化加购建议（v1.2.0；价格为**预计**，以官方结算为准） */
export interface BundleSuggestion {
  /** 命中的满减券文案 */
  couponText: string;
  /** 满减门槛（元） */
  threshold: number;
  /** 券面额（元） */
  amount: number;
  /** 建议加购的候选 code */
  addCode: string;
  /** 建议加购的候选名称 */
  addName: string;
  /** 加购价（元） */
  addPrice: number;
  /** 当前主推券后价（元） */
  currentPay: number;
  /** 凑单后预计应付（元） */
  bundlePay: number;
  /** 预计净省（元） */
  saved: number;
}

/** 推荐结果 */
export interface Recommendation {
  primary: MealCandidate;
  /** 备选（≤2） */
  alternatives: MealCandidate[];
  /** 可解释理由（≥2 条） */
  reasons: string[];
  /** ISO8601 */
  generatedAt: string;
  /** 是否使用离线降级数据 */
  degraded: boolean;
  /** 输出所用时区 */
  timezone?: string;
  /** 实际生效的场景（v1.1.0，auto 未命中时为 undefined 表示用基准权重） */
  scene?: Exclude<Scene, 'auto'>;
  /** 是否冷启动推荐（v1.1.0） */
  coldStart?: boolean;
  /** 凑单/券最大化加购建议（v1.2.0） */
  bundle?: BundleSuggestion;
}
