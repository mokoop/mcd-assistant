import { describe, expect, it } from 'vitest';

import { TtlCache, cacheKeyOf, stableStringify } from '@/mcp-client/cache';

describe('stableStringify / cacheKeyOf', () => {
  it('对象键顺序不影响结果', () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
    expect(cacheKeyOf('t', { a: 1, b: 2 })).toBe(cacheKeyOf('t', { b: 2, a: 1 }));
  });

  it('忽略 undefined 字段', () => {
    expect(cacheKeyOf('t', { a: 1, b: undefined })).toBe(cacheKeyOf('t', { a: 1 }));
  });
});

describe('TtlCache', () => {
  it('命中缓存并在 TTL 过期后失效', () => {
    let now = 1000;
    const cache = new TtlCache(() => now);
    cache.set('k', { v: 1 }, 100);

    expect(cache.get('k')).toEqual({ v: 1 });
    now = 1099;
    expect(cache.get('k')).toEqual({ v: 1 });
    now = 1101;
    expect(cache.get('k')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('ttl<=0 时写入即失效', () => {
    const cache = new TtlCache(() => 0);
    cache.set('k', 'v', 0);
    expect(cache.get('k')).toBeUndefined();
  });
});
