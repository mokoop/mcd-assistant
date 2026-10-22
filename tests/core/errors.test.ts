import { describe, expect, it } from 'vitest';

import { AppError, ErrorCode, isAppError, isRetryableErrorCode, toAppError } from '@/core/errors';

describe('AppError', () => {
  it('保留错误码、消息与 cause', () => {
    const cause = new Error('底层失败');
    const error = new AppError({ code: ErrorCode.AUTH_FAILED, message: '鉴权失败', cause });

    expect(error).toBeInstanceOf(AppError);
    expect(error.name).toBe('AppError');
    expect(error.code).toBe(ErrorCode.AUTH_FAILED);
    expect(error.message).toBe('鉴权失败');
    expect(error.cause).toBe(cause);
  });

  it('按错误码推断是否可重试', () => {
    expect(isRetryableErrorCode(ErrorCode.RATE_LIMITED)).toBe(true);
    expect(isRetryableErrorCode(ErrorCode.TIMEOUT)).toBe(true);
    expect(isRetryableErrorCode(ErrorCode.AUTH_FAILED)).toBe(false);

    expect(new AppError({ code: ErrorCode.TIMEOUT, message: 'x' }).retryable).toBe(true);
    expect(new AppError({ code: ErrorCode.EMPTY_RESULT, message: 'x' }).retryable).toBe(false);
  });

  it('isAppError 仅对 AppError 命中', () => {
    expect(isAppError(new AppError({ code: ErrorCode.UNKNOWN, message: 'x' }))).toBe(true);
    expect(isAppError(new Error('x'))).toBe(false);
    expect(isAppError(undefined)).toBe(false);
  });
});

describe('toAppError', () => {
  it('已是 AppError 时原样返回', () => {
    const original = new AppError({ code: ErrorCode.PARSE_ERROR, message: 'parse' });
    expect(toAppError(original)).toBe(original);
  });

  it('将 Error 包装为 UNKNOWN 并保留 cause', () => {
    const raw = new Error('boom');
    const wrapped = toAppError(raw);
    expect(wrapped.code).toBe(ErrorCode.UNKNOWN);
    expect(wrapped.message).toBe('boom');
    expect(wrapped.cause).toBe(raw);
  });

  it('将非 Error 值包装并使用兜底消息', () => {
    expect(toAppError(undefined).message).toBe('发生未知错误');
    expect(toAppError('自定义消息').message).toBe('自定义消息');
  });
});
