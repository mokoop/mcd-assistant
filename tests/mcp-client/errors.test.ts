import { describe, expect, it } from 'vitest';

import { AppError, ErrorCode } from '@/core/errors';
import { isTimeoutError, mapTransportError } from '@/mcp-client/errors';

describe('mapTransportError', () => {
  it('401/403 → AUTH_FAILED（不可重试）', () => {
    expect(mapTransportError({ status: 401 }).code).toBe(ErrorCode.AUTH_FAILED);
    expect(mapTransportError({ statusCode: 403 }).code).toBe(ErrorCode.AUTH_FAILED);
    expect(mapTransportError({ status: 401 }).retryable).toBe(false);
  });

  it('429 → RATE_LIMITED（可重试）', () => {
    const error = mapTransportError({ code: 429 });
    expect(error.code).toBe(ErrorCode.RATE_LIMITED);
    expect(error.retryable).toBe(true);
  });

  it('超时/中止 → TIMEOUT（可重试）', () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    expect(isTimeoutError(abort)).toBe(true);
    const error = mapTransportError(abort);
    expect(error.code).toBe(ErrorCode.TIMEOUT);
    expect(error.retryable).toBe(true);
  });

  it('其余 → UNKNOWN', () => {
    expect(mapTransportError(new Error('boom')).code).toBe(ErrorCode.UNKNOWN);
  });

  it('已是 AppError 时原样返回', () => {
    const original = new AppError({ code: ErrorCode.PARSE_ERROR, message: 'x' });
    expect(mapTransportError(original)).toBe(original);
  });
});
