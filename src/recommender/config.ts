/**
 * recommender 集中参数入口（技术设计 §4.2 关键参数表 + §7 可配置性）。
 *
 * 本文件是**推荐模块单一调参面**：既定义打分权重与 Top-K 等推荐自身参数，
 * 又以 re-export 形式汇聚 profile / mcp-client 的可调参数（超时、缓存 TTL、EMA 等），
 * 便于压测后统一校准。
 */

/** 打分权重（各权重之和应为 1） */
export interface RecommenderWeights {
  /** w1 品类/口味匹配 */
  category: number;
  /** w2 价格带匹配 */
  price: number;
  /** w3 营养契合 */
  nutrition: number;
  /** w4 券后性价比 */
  value: number;
  /** w5 多样性（新颖度） */
  novelty: number;
  /** w6 口味标签契合（v1.1.0） */
  taste: number;
  /** w7 门店热销（v1.1.0，仅冷启动为主） */
  popularity: number;
}

/** recommender 配置 */
export interface RecommenderConfig {
  weights: RecommenderWeights;
  /** Top-K：券后试算的候选数量（默认 5） */
  topK: number;
  /** M：单次推荐券后试算次数上限（默认 5） */
  maxTrials: number;
  /** 多样性判定所看的近期历史条数（默认 10） */
  recentHistoryWindow: number;
  /** 凑单建议：距满减门槛的最大差额（元，默认 20，v1.2.0） */
  bundleMaxGap: number;
}

/**
 * 默认（温启动）配置（依据见设计 §2.3）：
 * - 偏好（品类）为主要信号，给最高权重；
 * - 价格带与券后性价比并重（省钱是核心诉求）；
 * - 营养为约束性信号，权重中等；
 * - 口味标签为辅助信号；
 * - 多样性权重最低，仅用于避免"总推同类"；
 * - 热销 popularity 仅用于冷启动，温启动权重置 0。
 * 权重之和 = 1，便于将 score 归一化到 0~1 区间。
 */
export const DEFAULT_RECOMMENDER_CONFIG: RecommenderConfig = {
  weights: { category: 0.3, price: 0.18, nutrition: 0.14, value: 0.18, novelty: 0.1, taste: 0.1, popularity: 0 },
  topK: 5,
  maxTrials: 5,
  recentHistoryWindow: 10,
  bundleMaxGap: 20,
};

/**
 * 冷启动权重（v1.1.0 设计 §2.3）：无画像时提高**门店热销**与**券后性价比**权重，
 * 并让口味标签参与；避免"仅价格维度"导致的随机观感。权重之和 = 1。
 */
export const COLD_START_WEIGHTS: RecommenderWeights = {
  category: 0.05,
  price: 0.2,
  nutrition: 0.1,
  value: 0.25,
  novelty: 0.1,
  taste: 0.15,
  popularity: 0.15,
};

/** 解析生效配置（`overrides` 优先级最高；weights 支持部分覆盖） */
export function resolveRecommenderConfig(
  overrides: Partial<Omit<RecommenderConfig, 'weights'>> & { weights?: Partial<RecommenderWeights> } = {},
): RecommenderConfig {
  const { weights, ...rest } = overrides;
  return {
    ...DEFAULT_RECOMMENDER_CONFIG,
    ...rest,
    weights: { ...DEFAULT_RECOMMENDER_CONFIG.weights, ...weights },
  };
}

// ── 单一调参面：汇聚下游模块可调参数 ─────────────────────────────────────────

export { DEFAULT_PROFILE_CONFIG, resolveProfileConfig } from '../profile/config.js';
export type { ProfileConfig } from '../profile/config.js';
export {
  DEFAULT_CONFIG as DEFAULT_MCP_CLIENT_CONFIG,
  loadConfig as loadMcpClientConfig,
} from '../mcp-client/config.js';
export type { McpClientConfig } from '../mcp-client/config.js';
