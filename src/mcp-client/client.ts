/**
 * 传输封装与调用器（技术设计 §3.2 / §3.3）：
 * - `createSdkTransport`：真实实现，基于 MCP SDK（Streamable HTTP + Bearer）；
 * - `ToolInvoker`：并发上限 + 超时 + 429/超时指数退避 + 错误映射。
 * 传输抽为可注入接口 `ToolTransport`，测试可注入假实现（零网络）。
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { AppError, ErrorCode } from '../core/errors.js';
import { createLogger, type Logger } from '../core/logger.js';

import { mapTransportError } from './errors.js';

import type { McpClientConfig } from './config.js';
import type { RawToolResult, ToolTransport } from './types.js';

const CLIENT_INFO = { name: 'mcd-meal-recommender', version: '1.0.0' } as const;

/** 服务端返回内容片段（仅取用所需字段） */
interface TextContent {
  type?: unknown;
  text?: unknown;
}

/** SDK `callTool` 返回结构（收窄用） */
interface SdkCallToolResult {
  content?: unknown;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/** 将 SDK 返回归一为 `RawToolResult` */
function normalizeResult(result: unknown): RawToolResult {
  const value = (result ?? {}) as SdkCallToolResult;
  const content = Array.isArray(value.content) ? (value.content as TextContent[]) : [];
  const text = content
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('\n');
  return {
    text,
    ...(value.structuredContent ? { structured: value.structuredContent } : {}),
    ...(typeof value.isError === 'boolean' ? { isError: value.isError } : {}),
  };
}

/** 创建基于 MCP SDK 的真实传输（惰性连接） */
export function createSdkTransport(config: McpClientConfig): ToolTransport {
  const logger = createLogger({ module: 'mcp-client.transport' });
  let client: Client | undefined;
  let transport: StreamableHTTPClientTransport | undefined;

  async function ensureConnected(): Promise<Client> {
    if (client) {
      return client;
    }
    if (!config.token) {
      throw new AppError({
        code: ErrorCode.TOKEN_MISSING,
        message: `未配置 ${'MCD_MCP_TOKEN'}，无法访问 mcd-mcp`,
        retryable: false,
      });
    }
    transport = new StreamableHTTPClientTransport(new URL(config.baseUrl), {
      requestInit: {
        headers: { Authorization: `Bearer ${config.token}` },
      },
    });
    const created = new Client(CLIENT_INFO, { capabilities: {} });
    await created.connect(transport);
    client = created;
    logger.debug('已连接 mcd-mcp', { url: config.baseUrl });
    return client;
  }

  return {
    async callTool(name, args) {
      const connected = await ensureConnected();
      const result = await connected.callTool({ name, arguments: args });
      return normalizeResult(result);
    },
    async close() {
      try {
        await transport?.close();
      } finally {
        client = undefined;
        transport = undefined;
      }
    },
  };
}

/** 并发信号量 */
class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async acquire(): Promise<() => void> {
    if (this.active < this.limit) {
      this.active += 1;
    } else {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    return () => {
      this.release();
    };
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
    } else {
      this.active -= 1;
    }
  }
}

/** 可注入的延时函数（默认 setTimeout；测试可用假定时器） */
export type SleepFn = (ms: number) => Promise<void>;

const defaultSleep: SleepFn = (ms) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/** 调用器：负责超时、并发限制、退避重试与错误映射 */
export class ToolInvoker {
  private readonly semaphore: Semaphore;
  private readonly logger: Logger;

  constructor(
    private readonly transport: ToolTransport,
    private readonly config: McpClientConfig,
    private readonly sleep: SleepFn = defaultSleep,
    logger?: Logger,
  ) {
    this.semaphore = new Semaphore(Math.max(1, config.maxConcurrency));
    this.logger = logger ?? createLogger({ module: 'mcp-client.invoker' });
  }

  /** 调用工具：可重试错误按指数退避重试，超限后抛出映射后的 `AppError` */
  async call(name: string, args: Record<string, unknown>): Promise<RawToolResult> {
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt += 1) {
      try {
        return await this.attempt(name, args);
      } catch (error) {
        const appError = mapTransportError(error);
        if (!appError.retryable || attempt === this.config.maxRetries) {
          throw appError;
        }
        const delayMs = this.config.backoffBaseMs * 2 ** attempt;
        this.logger.warn('MCP 调用失败，退避重试', {
          tool: name,
          attempt: attempt + 1,
          maxRetries: this.config.maxRetries,
          code: appError.code,
          delayMs,
        });
        await this.sleep(delayMs);
      }
    }
    // 理论上不可达；for 循环内必然返回或抛出
    throw new AppError({ code: ErrorCode.UNKNOWN, message: `调用 ${name} 失败` });
  }

  private async attempt(name: string, args: Record<string, unknown>): Promise<RawToolResult> {
    const release = await this.semaphore.acquire();
    try {
      return await this.withTimeout(this.transport.callTool(name, args));
    } finally {
      release();
    }
  }

  private withTimeout<T>(promise: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(
          new AppError({
            code: ErrorCode.TIMEOUT,
            message: `MCP 调用超时（${this.config.timeoutMs}ms）`,
            retryable: true,
          }),
        );
      }, this.config.timeoutMs);
    });
    // 超时后原 Promise 的拒绝不应成为 unhandledRejection
    promise.catch(() => undefined);
    return Promise.race([promise, timeout]).finally(() => {
      if (timer) {
        clearTimeout(timer);
      }
    });
  }

  /** 关闭底层传输 */
  async close(): Promise<void> {
    await this.transport.close();
  }
}
