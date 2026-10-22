/**
 * mcp-client 可调参数（技术设计 §3.2 / §4.2 / §5）。
 * 超时、重试上限、退避基数、并发上限、缓存 TTL 集中于此，便于压测校准。
 */

/** 麦当劳 MCP 端点 */
export const MCD_MCP_URL = 'https://mcp.mcd.cn';

/** 鉴权环境变量名 */
export const ENV_TOKEN = 'MCD_MCP_TOKEN';
/** 离线开关环境变量名 */
export const ENV_OFFLINE = 'MCD_OFFLINE';

/** 缓存 TTL 配置（毫秒） */
export interface CacheTtlConfig {
  /** 菜单/营养（默认 10min） */
  menuMs: number;
  /** 券（默认 5min） */
  couponMs: number;
}

/** mcp-client 运行配置 */
export interface McpClientConfig {
  baseUrl: string;
  /** MCD_MCP_TOKEN；未配置时走离线降级 */
  token?: string;
  /** MCD_OFFLINE=1 时强制离线（零 MCP 调用） */
  offline: boolean;
  /** 单次调用超时（ms） */
  timeoutMs: number;
  /** 可重试错误的退避重试上限（次） */
  maxRetries: number;
  /** 指数退避基数（ms）：delay = base * 2^attempt */
  backoffBaseMs: number;
  /** 并发上限 */
  maxConcurrency: number;
  cacheTtl: CacheTtlConfig;
}

/** 默认配置 */
export const DEFAULT_CONFIG: McpClientConfig = {
  baseUrl: MCD_MCP_URL,
  offline: false,
  timeoutMs: 10_000,
  maxRetries: 3,
  backoffBaseMs: 300,
  maxConcurrency: 4,
  cacheTtl: {
    menuMs: 10 * 60_000,
    couponMs: 5 * 60_000,
  },
};

/** 从环境变量加载配置（未设置项回退默认值） */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): McpClientConfig {
  const token = env[ENV_TOKEN]?.trim();
  return {
    ...DEFAULT_CONFIG,
    token: token && token.length > 0 ? token : undefined,
    offline: env[ENV_OFFLINE] === '1',
    cacheTtl: { ...DEFAULT_CONFIG.cacheTtl },
  };
}

/** mcd-mcp 工具名常量（技术设计 §3.1） */
export const TOOL = {
  nowTimeInfo: 'now-time-info',
  queryNearbyStores: 'query-nearby-stores',
  deliveryQueryAddresses: 'delivery-query-addresses',
  deliveryQueryStores: 'delivery-query-stores',
  queryMeals: 'query-meals',
  queryMealDetail: 'query-meal-detail',
  listNutritionFoods: 'list-nutrition-foods',
  availableCoupons: 'available-coupons',
  queryStoreCoupons: 'query-store-coupons',
  queryMyCoupons: 'query-my-coupons',
  calculatePrice: 'calculate-price',
  campaignCalendar: 'campaign-calendar',
  autoBindCoupons: 'auto-bind-coupons',
} as const;

/** 工具名联合类型 */
export type ToolName = (typeof TOOL)[keyof typeof TOOL];
