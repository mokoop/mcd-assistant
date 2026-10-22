import { describe, expect, it } from 'vitest';

import { ErrorCode } from '@/core/errors';
import { ToolInvoker, createSdkTransport } from '@/mcp-client/client';
import { DEFAULT_CONFIG } from '@/mcp-client/config';
import type { RawToolResult, ToolTransport } from '@/mcp-client/types';

describe('createSdkTransport', () => {
  it('未配置 token 时连接报 TOKEN_MISSING', async () => {
    const transport = createSdkTransport({ ...DEFAULT_CONFIG, token: undefined });
    await expect(transport.callTool('now-time-info', {})).rejects.toMatchObject({ code: ErrorCode.TOKEN_MISSING });
    await transport.close();
  });
});

describe('ToolInvoker 并发上限', () => {
  it('并发上限为 1 时调用串行执行', async () => {
    let active = 0;
    let maxActive = 0;
    const transport: ToolTransport = {
      async callTool(): Promise<RawToolResult> {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return { text: '{}' };
      },
      async close() {
        /* noop */
      },
    };
    const invoker = new ToolInvoker(transport, { ...DEFAULT_CONFIG, maxConcurrency: 1 });
    await Promise.all([invoker.call('t', { i: 1 }), invoker.call('t', { i: 2 }), invoker.call('t', { i: 3 })]);
    expect(maxActive).toBe(1);
    await invoker.close();
  });
});
