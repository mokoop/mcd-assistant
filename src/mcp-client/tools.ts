/**
 * 工具函数层（技术设计 §3.2 / §3.3 / §5）：按工具组织「鉴权 → 缓存 → 解析 → 降级」。
 *
 * 对外每个工具返回 `ToolResult<T>`（含 `degraded` 标记）。
 * 降级策略：
 * - `MCD_OFFLINE=1` → 直接离线数据，零 MCP 调用；
 * - 无 Token / 401 / 超时 / 限流（重试耗尽）→ 回退离线数据并标注 degraded；
 * - 解析失败：列表类（optional）视为空结果并告警、不中断；关键类抛 `PARSE_ERROR`；
 * - 业务空结果（关键工具）→ 抛 `EMPTY_RESULT`。
 */

import { AppError, ErrorCode } from '../core/errors.js';
import { createLogger, type Logger } from '../core/logger.js';

import { TtlCache, cacheKeyOf } from './cache.js';
import { ToolInvoker, createSdkTransport, type SleepFn } from './client.js';
import { TOOL, loadConfig, type McpClientConfig, type ToolName } from './config.js';
import { mapTransportError } from './errors.js';
import { createOfflineProvider } from './offline/index.js';
import {
  parseAddresses,
  parseBoundCoupons,
  parseCalculatePrice,
  parseCampaigns,
  parseCoupons,
  parseMealDetail,
  parseMeals,
  parseNowTimeInfo,
  parseNutritionFoods,
  parseStoreCoupons,
  parseStores,
} from './parsers/index.js';

import type {
  CalculatePriceQuery,
  CampaignCalendarQuery,
  DeliveryStoresQuery,
  MealDetailQuery,
  NearbyStoresQuery,
  OfflineProvider,
  RawToolResult,
  StoreCouponsQuery,
  StoreMenuQuery,
  ToolResult,
  ToolTransport,
} from './types.js';
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

/** 可降级错误码（无 Token / 鉴权失败 / 超时 / 限流） */
function isDegradableError(code: ErrorCode): boolean {
  return (
    code === ErrorCode.TOKEN_MISSING ||
    code === ErrorCode.AUTH_FAILED ||
    code === ErrorCode.TIMEOUT ||
    code === ErrorCode.RATE_LIMITED
  );
}

/** 门店关键词长度上限（需求 AC 6.6-3） */
const KEYWORD_MAX_LENGTH = 100;

/** 校验门店检索关键词：空串或超长 → `AppError(VALIDATION_ERROR)`（不发起调用） */
function assertValidKeyword(keyword: string | undefined): void {
  if (keyword === undefined) {
    return;
  }
  if (keyword.length < 1 || keyword.length > KEYWORD_MAX_LENGTH) {
    throw new AppError({
      code: ErrorCode.VALIDATION_ERROR,
      message: `门店关键词长度需在 1–${KEYWORD_MAX_LENGTH} 之间（当前 ${keyword.length}）。`,
    });
  }
}

interface ToolSpec<T> {
  tool: ToolName;
  args: Record<string, unknown>;
  parse: (raw: RawToolResult) => T;
  offline: () => T;
  cacheTtlMs?: number;
  /** 列表类工具：解析失败 → 空结果并告警，不中断 */
  optional?: boolean;
  emptyFallback?: () => T;
  isEmpty?: (data: T) => boolean;
}

/** mcp-client 对外接口 */
export interface McpClient {
  nowTimeInfo(): Promise<ToolResult<NowTimeInfo>>;
  queryNearbyStores(query?: NearbyStoresQuery): Promise<ToolResult<StoreInfo[]>>;
  deliveryQueryAddresses(): Promise<ToolResult<DeliveryAddress[]>>;
  deliveryQueryStores(query: DeliveryStoresQuery): Promise<ToolResult<StoreInfo[]>>;
  queryMeals(query: StoreMenuQuery): Promise<ToolResult<MealsQueryResult>>;
  queryMealDetail(query: MealDetailQuery): Promise<ToolResult<MealDetail>>;
  listNutritionFoods(): Promise<ToolResult<NutritionFood[]>>;
  availableCoupons(): Promise<ToolResult<CouponInfo[]>>;
  queryStoreCoupons(query: StoreCouponsQuery): Promise<ToolResult<CouponInfo[]>>;
  queryMyCoupons(): Promise<ToolResult<CouponInfo[]>>;
  calculatePrice(query: CalculatePriceQuery): Promise<ToolResult<CalculatePriceResult>>;
  campaignCalendar(query?: CampaignCalendarQuery): Promise<ToolResult<CampaignInfo[]>>;
  /** 写操作：一键领券（须用户显式确认，非推荐主链路） */
  autoBindCoupons(): Promise<ToolResult<BoundCoupon[]>>;
  close(): Promise<void>;
}

/** `createMcpClient` 选项（测试可注入 transport / offline / sleep） */
export interface CreateMcpClientOptions {
  config?: Partial<McpClientConfig>;
  transport?: ToolTransport;
  offlineProvider?: OfflineProvider;
  cache?: TtlCache;
  sleep?: SleepFn;
  logger?: Logger;
  now?: () => number;
}

/** 解析生效配置：以环境变量（`loadConfig`）为默认基线，`partial` 覆盖之 */
function resolveConfig(partial?: Partial<McpClientConfig>): McpClientConfig {
  const base = loadConfig();
  return {
    ...base,
    ...partial,
    cacheTtl: { ...base.cacheTtl, ...partial?.cacheTtl },
  };
}

function toArgs(query: object | undefined): Record<string, unknown> {
  return query ? { ...query } : {};
}

/** 创建 mcp-client 实例 */
export function createMcpClient(options: CreateMcpClientOptions = {}): McpClient {
  const config = resolveConfig(options.config);
  const transport = options.transport ?? createSdkTransport(config);
  const offline = options.offlineProvider ?? createOfflineProvider();
  const cache = options.cache ?? new TtlCache(options.now ?? Date.now);
  const logger = options.logger ?? createLogger({ module: 'mcp-client' });
  const invoker = new ToolInvoker(transport, config, options.sleep, logger);

  async function runTool<T>(spec: ToolSpec<T>): Promise<ToolResult<T>> {
    const cacheKey = spec.cacheTtlMs ? cacheKeyOf(spec.tool, spec.args) : undefined;
    if (cacheKey) {
      const hit = cache.get<T>(cacheKey);
      if (hit !== undefined) {
        return { data: hit, degraded: false };
      }
    }

    if (config.offline) {
      logger.warn('离线模式：使用演示数据', { tool: spec.tool });
      return { data: spec.offline(), degraded: true };
    }

    try {
      const raw = await invoker.call(spec.tool, spec.args);
      if (raw.isError) {
        throw new AppError({ code: ErrorCode.EMPTY_RESULT, message: `工具 ${spec.tool} 执行失败` });
      }
      const data = spec.parse(raw);
      if (spec.isEmpty?.(data)) {
        throw new AppError({ code: ErrorCode.EMPTY_RESULT, message: `工具 ${spec.tool} 无可用结果` });
      }
      if (cacheKey && spec.cacheTtlMs) {
        cache.set(cacheKey, data, spec.cacheTtlMs);
      }
      return { data, degraded: false };
    } catch (error) {
      const appError = mapTransportError(error);
      if (isDegradableError(appError.code)) {
        logger.warn('实时调用不可用，降级离线数据', { tool: spec.tool, code: appError.code });
        return { data: spec.offline(), degraded: true };
      }
      if (spec.optional && appError.code === ErrorCode.PARSE_ERROR) {
        logger.warn('解析失败，视为空结果（不中断）', { tool: spec.tool });
        return { data: (spec.emptyFallback ?? spec.offline)(), degraded: false };
      }
      throw appError;
    }
  }

  const menuTtl = config.cacheTtl.menuMs;
  const couponTtl = config.cacheTtl.couponMs;

  return {
    nowTimeInfo: () =>
      runTool<NowTimeInfo>({
        tool: TOOL.nowTimeInfo,
        args: {},
        parse: parseNowTimeInfo,
        offline: () => offline.nowTimeInfo(),
      }),

    queryNearbyStores: async (query = {}) => {
      assertValidKeyword(query.keyword);
      return runTool<StoreInfo[]>({
        tool: TOOL.queryNearbyStores,
        args: toArgs(query),
        parse: parseStores,
        offline: () => offline.queryNearbyStores(query),
        isEmpty: (stores) => stores.length === 0,
      });
    },

    deliveryQueryAddresses: () =>
      runTool<DeliveryAddress[]>({
        tool: TOOL.deliveryQueryAddresses,
        args: {},
        parse: parseAddresses,
        offline: () => offline.deliveryQueryAddresses(),
        optional: true,
        emptyFallback: () => [],
      }),

    deliveryQueryStores: (query) =>
      runTool<StoreInfo[]>({
        tool: TOOL.deliveryQueryStores,
        args: toArgs(query),
        parse: parseStores,
        offline: () => offline.deliveryQueryStores(query),
        isEmpty: (stores) => stores.length === 0,
      }),

    queryMeals: (query) =>
      runTool<MealsQueryResult>({
        tool: TOOL.queryMeals,
        args: toArgs(query),
        parse: parseMeals,
        offline: () => offline.queryMeals(query),
        cacheTtlMs: menuTtl,
        isEmpty: (result) => Object.keys(result.meals).length === 0,
      }),

    queryMealDetail: (query) =>
      runTool<MealDetail>({
        tool: TOOL.queryMealDetail,
        args: toArgs(query),
        parse: parseMealDetail,
        offline: () => offline.queryMealDetail(query),
        cacheTtlMs: menuTtl,
      }),

    listNutritionFoods: () =>
      runTool<NutritionFood[]>({
        tool: TOOL.listNutritionFoods,
        args: {},
        parse: (raw) => parseNutritionFoods(raw.text),
        offline: () => offline.listNutritionFoods(),
        cacheTtlMs: menuTtl,
        optional: true,
        emptyFallback: () => [],
      }),

    availableCoupons: () =>
      runTool<CouponInfo[]>({
        tool: TOOL.availableCoupons,
        args: {},
        parse: (raw) => parseCoupons(raw.text),
        offline: () => offline.availableCoupons(),
        cacheTtlMs: couponTtl,
        optional: true,
        emptyFallback: () => [],
      }),

    queryStoreCoupons: (query) =>
      runTool<CouponInfo[]>({
        tool: TOOL.queryStoreCoupons,
        args: toArgs(query),
        parse: parseStoreCoupons,
        offline: () => offline.queryStoreCoupons(query),
        cacheTtlMs: couponTtl,
        optional: true,
        emptyFallback: () => [],
      }),

    queryMyCoupons: () =>
      runTool<CouponInfo[]>({
        tool: TOOL.queryMyCoupons,
        args: {},
        parse: (raw) => parseCoupons(raw.text),
        offline: () => offline.queryMyCoupons(),
        cacheTtlMs: couponTtl,
        optional: true,
        emptyFallback: () => [],
      }),

    calculatePrice: (query) =>
      runTool<CalculatePriceResult>({
        tool: TOOL.calculatePrice,
        args: toArgs(query),
        parse: parseCalculatePrice,
        offline: () => offline.calculatePrice(query),
      }),

    campaignCalendar: (query = {}) =>
      runTool<CampaignInfo[]>({
        tool: TOOL.campaignCalendar,
        args: toArgs(query),
        parse: (raw) => parseCampaigns(raw.text),
        offline: () => offline.campaignCalendar(query),
        optional: true,
        emptyFallback: () => [],
      }),

    autoBindCoupons: () =>
      runTool<BoundCoupon[]>({
        tool: TOOL.autoBindCoupons,
        args: {},
        parse: parseBoundCoupons,
        offline: () => offline.autoBindCoupons(),
        isEmpty: (coupons) => coupons.length === 0,
      }),

    close: () => invoker.close(),
  };
}

let defaultClient: McpClient | undefined;

/** 获取默认 mcp-client 单例（按环境变量加载配置） */
export function getDefaultMcpClient(): McpClient {
  if (!defaultClient) {
    defaultClient = createMcpClient();
  }
  return defaultClient;
}

// ── 便捷命名导出（供 reminder / recommender / index 直接调用） ────────────────

export const nowTimeInfo = (): Promise<ToolResult<NowTimeInfo>> => getDefaultMcpClient().nowTimeInfo();
export const queryNearbyStores = (query?: NearbyStoresQuery): Promise<ToolResult<StoreInfo[]>> =>
  getDefaultMcpClient().queryNearbyStores(query);
export const deliveryQueryAddresses = (): Promise<ToolResult<DeliveryAddress[]>> =>
  getDefaultMcpClient().deliveryQueryAddresses();
export const deliveryQueryStores = (query: DeliveryStoresQuery): Promise<ToolResult<StoreInfo[]>> =>
  getDefaultMcpClient().deliveryQueryStores(query);
export const queryMeals = (query: StoreMenuQuery): Promise<ToolResult<MealsQueryResult>> =>
  getDefaultMcpClient().queryMeals(query);
export const queryMealDetail = (query: MealDetailQuery): Promise<ToolResult<MealDetail>> =>
  getDefaultMcpClient().queryMealDetail(query);
export const listNutritionFoods = (): Promise<ToolResult<NutritionFood[]>> =>
  getDefaultMcpClient().listNutritionFoods();
export const availableCoupons = (): Promise<ToolResult<CouponInfo[]>> =>
  getDefaultMcpClient().availableCoupons();
export const queryStoreCoupons = (query: StoreCouponsQuery): Promise<ToolResult<CouponInfo[]>> =>
  getDefaultMcpClient().queryStoreCoupons(query);
export const queryMyCoupons = (): Promise<ToolResult<CouponInfo[]>> => getDefaultMcpClient().queryMyCoupons();
export const calculatePrice = (query: CalculatePriceQuery): Promise<ToolResult<CalculatePriceResult>> =>
  getDefaultMcpClient().calculatePrice(query);
export const campaignCalendar = (query?: CampaignCalendarQuery): Promise<ToolResult<CampaignInfo[]>> =>
  getDefaultMcpClient().campaignCalendar(query);
export const autoBindCoupons = (): Promise<ToolResult<BoundCoupon[]>> => getDefaultMcpClient().autoBindCoupons();
