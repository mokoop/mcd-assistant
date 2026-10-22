/**
 * 传输/调用错误 → 统一 `AppError` 映射（技术设计 §3.3）。
 * 401→AUTH_FAILED、429→RATE_LIMITED、超时→TIMEOUT；其余归 UNKNOWN。
 */

import { AppError, ErrorCode } from '../core/errors.js';

/** 可能出现在底层错误对象上的状态码字段 */
interface StatusCarrier {
  code?: unknown;
  status?: unknown;
  statusCode?: unknown;
}

function extractStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const carrier = error as StatusCarrier;
  for (const candidate of [carrier.status, carrier.statusCode, carrier.code]) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate;
    }
    if (typeof candidate === 'string' && /^\d{3}$/.test(candidate)) {
      return Number(candidate);
    }
  }
  return undefined;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === 'string' ? error : 'MCP 调用失败';
}

/** 是否为超时/中止错误 */
export function isTimeoutError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const name = (error as { name?: unknown }).name;
  if (name === 'AbortError' || name === 'TimeoutError') {
    return true;
  }
  const message = messageOf(error).toLowerCase();
  return message.includes('timeout') || message.includes('timed out') || message.includes('超时');
}

/**
 * 将底层错误映射为语义化 `AppError`；已是 `AppError` 时原样返回。
 * - 401 → AUTH_FAILED（不可重试）
 * - 429 → RATE_LIMITED（可重试）
 * - 超时/中止 → TIMEOUT（可重试）
 */
export function mapTransportError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  const status = extractStatus(error);
  if (status === 401 || status === 403) {
    return new AppError({
      code: ErrorCode.AUTH_FAILED,
      message: `MCP 鉴权失败（HTTP ${status}）：请检查 ${'MCD_MCP_TOKEN'} 是否有效`,
      cause: error,
      retryable: false,
    });
  }
  if (status === 429) {
    return new AppError({
      code: ErrorCode.RATE_LIMITED,
      message: 'MCP 触发限流（HTTP 429）',
      cause: error,
      retryable: true,
    });
  }
  if (isTimeoutError(error)) {
    return new AppError({
      code: ErrorCode.TIMEOUT,
      message: `MCP 调用超时：${messageOf(error)}`,
      cause: error,
      retryable: true,
    });
  }

  const message = messageOf(error);
  if (/401/.test(message)) {
    return new AppError({ code: ErrorCode.AUTH_FAILED, message, cause: error, retryable: false });
  }
  if (/429/.test(message)) {
    return new AppError({ code: ErrorCode.RATE_LIMITED, message, cause: error, retryable: true });
  }

  return new AppError({ code: ErrorCode.UNKNOWN, message, cause: error });
}
