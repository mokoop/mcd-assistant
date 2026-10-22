/**
 * 统一错误类型与错误码（对应技术设计 §3.3 与 dev_spec §4.5.1「跨层错误统一使用 AppError」）。
 *
 * 约定：跨层（mcp-client / recommender / profile / reminder / index）抛出的错误统一为 `AppError`，
 * 携带语义化错误码，便于上层做「提示配置 / 退避重试 / 降级 / 友好输出」分支。
 */

/** 统一错误码 */
export enum ErrorCode {
  /** 未配置 MCD_MCP_TOKEN */
  TOKEN_MISSING = 'TOKEN_MISSING',
  /** 401：Token 无效/过期 */
  AUTH_FAILED = 'AUTH_FAILED',
  /** 429：触发限流 */
  RATE_LIMITED = 'RATE_LIMITED',
  /** 网络/MCP 调用超时 */
  TIMEOUT = 'TIMEOUT',
  /** 业务空结果（无可售门店/餐品等） */
  EMPTY_RESULT = 'EMPTY_RESULT',
  /** 非 JSON / TOON / Markdown 返回解析失败 */
  PARSE_ERROR = 'PARSE_ERROR',
  /** 输入校验失败（zod） */
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  /** 本地文件读写失败 */
  IO_ERROR = 'IO_ERROR',
  /** 未归类错误 */
  UNKNOWN = 'UNKNOWN',
}

/** 可重试错误码（用于统一决定是否指数退避重试） */
export function isRetryableErrorCode(code: ErrorCode): boolean {
  return code === ErrorCode.RATE_LIMITED || code === ErrorCode.TIMEOUT;
}

/** `AppError` 构造参数 */
export interface AppErrorOptions {
  code: ErrorCode;
  message: string;
  /** 原始错误，用于保留堆栈 */
  cause?: unknown;
  /** 是否可重试；缺省按错误码推断 */
  retryable?: boolean;
  /** 附加上下文（须为可安全记录的非敏感数据） */
  details?: Record<string, unknown>;
}

/** 跨层统一错误类型 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(options: AppErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = 'AppError';
    this.code = options.code;
    this.retryable = options.retryable ?? isRetryableErrorCode(options.code);
    this.details = options.details;
  }
}

/** 类型守卫：判断是否为 `AppError` */
export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/**
 * 将任意错误收窄为 `AppError`；已是 `AppError` 时原样返回，
 * 否则包装为 `ErrorCode.UNKNOWN`（保留原始 message 与 cause）。
 */
export function toAppError(value: unknown, fallbackMessage = '发生未知错误'): AppError {
  if (isAppError(value)) {
    return value;
  }
  if (value instanceof Error) {
    return new AppError({ code: ErrorCode.UNKNOWN, message: value.message, cause: value });
  }
  const message = typeof value === 'string' && value.length > 0 ? value : fallbackMessage;
  return new AppError({ code: ErrorCode.UNKNOWN, message, cause: value });
}
