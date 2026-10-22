/**
 * 内存 TTL 缓存（技术设计 §3.2 限流策略：命中缓存优先）。
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/** 稳定序列化：对对象键排序，保证相同入参生成相同缓存键 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`);
  return `{${entries.join(',')}}`;
}

/** 生成缓存键 */
export function cacheKeyOf(toolName: string, args: Record<string, unknown>): string {
  return `${toolName}:${stableStringify(args)}`;
}

/** 简单内存 TTL 缓存（单进程） */
export class TtlCache {
  private readonly store = new Map<string, CacheEntry<unknown>>();

  constructor(private readonly now: () => number = Date.now) {}

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt <= this.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    if (ttlMs <= 0) {
      return;
    }
    this.store.set(key, { value, expiresAt: this.now() + ttlMs });
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}
