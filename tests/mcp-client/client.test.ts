import { describe, expect, it, vi } from 'vitest';

import { AppError, ErrorCode } from '@/core/errors';
import { ToolInvoker } from '@/mcp-client/client';
import { DEFAULT_CONFIG } from '@/mcp-client/config';
import { createMcpClient } from '@/mcp-client/tools';
import type { RawToolResult, ToolTransport } from '@/mcp-client/types';

interface FakeTransport {
  transport: ToolTransport;
  calls: Array<{ name: string; args: Record<string, unknown> }>;
}

function createFake(handler: (name: string, args: Record<string, unknown>) => Promise<RawToolResult>): FakeTransport {
  const calls: FakeTransport['calls'] = [];
  return {
    calls,
    transport: {
      async callTool(name, args) {
        calls.push({ name, args });
        return handler(name, args);
      },
      async close() {
        /* noop */
      },
    },
  };
}

const MEALS_JSON = JSON.stringify({
  meals: { M001: { code: 'M001', name: '巨无霸套餐', price: 39, category: '汉堡' } },
});

describe('ToolInvoker 退避重试', () => {
  it('429 按指数退避后成功', async () => {
    let attempts = 0;
    const { transport } = createFake(async () => {
      attempts += 1;
      if (attempts <= 2) {
        throw Object.assign(new Error('rate limited'), { status: 429 });
      }
      return { text: MEALS_JSON };
    });
    const sleeps: number[] = [];
    const invoker = new ToolInvoker(
      transport,
      { ...DEFAULT_CONFIG, maxRetries: 3, backoffBaseMs: 10 },
      async (ms) => {
        sleeps.push(ms);
      },
    );
    const result = await invoker.call('query-meals', {});
    expect(result.text).toBe(MEALS_JSON);
    expect(attempts).toBe(3);
    expect(sleeps).toEqual([10, 20]);
  });

  it('429 重试耗尽后抛 RATE_LIMITED', async () => {
    const { transport } = createFake(async () => {
      throw Object.assign(new Error('rate limited'), { status: 429 });
    });
    const invoker = new ToolInvoker(transport, { ...DEFAULT_CONFIG, maxRetries: 1, backoffBaseMs: 1 }, async () => {});
    await expect(invoker.call('query-meals', {})).rejects.toMatchObject({ code: ErrorCode.RATE_LIMITED });
  });
});

describe('createMcpClient 缓存', () => {
  it('菜单在 TTL 内命中缓存，只调用一次传输', async () => {
    const { transport, calls } = createFake(async () => ({ text: MEALS_JSON }));
    const client = createMcpClient({ transport, config: { cacheTtl: { menuMs: 10_000, couponMs: 10_000 } } });
    const first = await client.queryMeals({ storeCode: 'S1', beCode: '2', orderType: 2, beType: 2 });
    const second = await client.queryMeals({ storeCode: 'S1', beCode: '2', orderType: 2, beType: 2 });
    expect(first.data.meals.M001?.name).toBe('巨无霸套餐');
    expect(second.degraded).toBe(false);
    expect(calls).toHaveLength(1);
  });
});

describe('离线模式', () => {
  it('MCD_OFFLINE 强制离线，零 MCP 调用且标注 degraded', async () => {
    const { transport, calls } = createFake(async () => {
      throw new Error('不应被调用');
    });
    const client = createMcpClient({ transport, config: { offline: true } });
    const result = await client.queryMeals({ storeCode: 'S1', beCode: '2', orderType: 2, beType: 2 });
    expect(result.degraded).toBe(true);
    expect(Object.keys(result.data.meals).length).toBeGreaterThan(0);
    expect(calls).toHaveLength(0);
    await client.close();
  });

  it('默认客户端遵循 MCD_OFFLINE 环境变量（零 MCP 调用）', async () => {
    vi.stubEnv('MCD_OFFLINE', '1');
    try {
      const { transport, calls } = createFake(async () => {
        throw new Error('不应被调用');
      });
      const client = createMcpClient({ transport });
      const result = await client.queryMeals({ storeCode: 'S1', beCode: '2', orderType: 2, beType: 2 });
      expect(result.degraded).toBe(true);
      expect(calls).toHaveLength(0);
      await client.close();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('降级', () => {
  it('无 Token（TOKEN_MISSING）→ 回退离线数据并标注 degraded', async () => {
    const { transport } = createFake(async () => {
      throw new AppError({ code: ErrorCode.TOKEN_MISSING, message: 'no token' });
    });
    const client = createMcpClient({ transport });
    const result = await client.queryMeals({ storeCode: 'S1', beCode: '2', orderType: 2, beType: 2 });
    expect(result.degraded).toBe(true);
    expect(Object.keys(result.data.meals).length).toBeGreaterThan(0);
  });

  it('429 耗尽 → 回退离线数据并标注 degraded', async () => {
    const { transport } = createFake(async () => {
      throw Object.assign(new Error('rate limited'), { status: 429 });
    });
    const client = createMcpClient({ transport, config: { maxRetries: 0 } });
    const result = await client.queryNearbyStores({ city: '上海' });
    expect(result.degraded).toBe(true);
    expect(result.data.length).toBeGreaterThan(0);
  });

  it('超时 → 回退离线数据并标注 degraded', async () => {
    const { transport } = createFake(() => new Promise<RawToolResult>(() => undefined));
    const client = createMcpClient({ transport, config: { timeoutMs: 5, maxRetries: 0 } });
    const result = await client.queryMeals({ storeCode: 'S1', beCode: '2', orderType: 2, beType: 2 });
    expect(result.degraded).toBe(true);
  });
});

describe('空结果与解析失败', () => {
  it('关键工具业务空结果抛 EMPTY_RESULT', async () => {
    const { transport } = createFake(async () => ({ text: '{"stores":[]}' }));
    const client = createMcpClient({ transport });
    await expect(client.queryNearbyStores({ city: '上海' })).rejects.toMatchObject({ code: ErrorCode.EMPTY_RESULT });
  });

  it('列表类工具解析失败视为空结果、不中断', async () => {
    const { transport } = createFake(async () => ({ text: '这不是 TOON' }));
    const client = createMcpClient({ transport });
    const result = await client.listNutritionFoods();
    expect(result.data).toEqual([]);
    expect(result.degraded).toBe(false);
  });

  it('Markdown/TOON 工具遇异常文本 → 空结果、不中断', async () => {
    const { transport } = createFake(async () => ({ text: '完全无法解析 | 的文本 |||' }));
    const client = createMcpClient({ transport });
    const [available, mine, store, campaigns] = await Promise.all([
      client.availableCoupons(),
      client.queryMyCoupons(),
      client.queryStoreCoupons({ storeCode: 'S1', beCode: '2', orderType: 2, beType: 2 }),
      client.campaignCalendar(),
    ]);
    expect(available.data).toEqual([]);
    expect(mine.data).toEqual([]);
    expect(store.data).toEqual([]);
    expect(campaigns.data).toEqual([]);
    expect(campaigns.degraded).toBe(false);
  });

  it('关键工具解析失败抛 PARSE_ERROR 而非中断推荐', async () => {
    const { transport } = createFake(async () => ({ text: 'not-json' }));
    const client = createMcpClient({ transport });
    await expect(client.nowTimeInfo()).rejects.toMatchObject({ code: ErrorCode.PARSE_ERROR });
  });

  it('BUG-3：queryNearbyStores 超长 keyword 抛 VALIDATION_ERROR 且不调用传输', async () => {
    const { transport, calls } = createFake(async () => ({ text: '{"stores":[]}' }));
    const client = createMcpClient({ transport });
    await expect(client.queryNearbyStores({ keyword: 'x'.repeat(101) })).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
    });
    expect(calls).toHaveLength(0);
  });

  it('BUG-3：queryNearbyStores 空 keyword 抛 VALIDATION_ERROR', async () => {
    const { transport } = createFake(async () => ({ text: '{"stores":[]}' }));
    const client = createMcpClient({ transport });
    await expect(client.queryNearbyStores({ keyword: '' })).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
    });
  });
});
