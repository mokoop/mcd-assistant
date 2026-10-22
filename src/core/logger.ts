/**
 * 统一日志设施（dev_spec §4.5.1）：
 * - 分级（debug/info/warn/error），级别由 `LOG_LEVEL` 环境变量控制；
 * - 除 Skill 交互输出外禁止直接 console.*，本模块是唯一允许写 stdout/stderr 的出口；
 * - 敏感字段（Token / 手机号 / 地址等）在写入前自动脱敏，避免隐私与凭据泄漏。
 */

/** 日志级别 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** 结构化日志字段 */
export interface LogFields {
  [key: string]: unknown;
}

/** 日志器接口 */
export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** 派生子日志器，附加固定上下文字段（如模块名） */
  child(context: LogFields): Logger;
}

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/** 命中即视为敏感键，其值将被脱敏 */
const SENSITIVE_KEY_PATTERN =
  /(token|secret|password|passwd|authorization|cookie|phone|mobile|telephone|\btel\b|address|contact)/i;

const REDACTED = '***';
const MAX_REDACT_DEPTH = 6;

function resolveLevel(value: string | undefined): LogLevel {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'debug' || normalized === 'info' || normalized === 'warn' || normalized === 'error') {
    return normalized;
  }
  return 'info';
}

let currentLevel: LogLevel = resolveLevel(process.env.LOG_LEVEL);

/** 设置全局日志级别 */
export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

/** 读取当前全局日志级别 */
export function getLogLevel(): LogLevel {
  return currentLevel;
}

/**
 * 字符串脱敏：保留末尾 `keepTail` 位，其余以 `*` 覆盖。
 * 为空串时返回空串；长度不足以保留时整体遮蔽。
 */
export function mask(value: string, keepTail = 4): string {
  if (value.length === 0) {
    return '';
  }
  if (value.length <= keepTail) {
    return '*'.repeat(value.length);
  }
  const head = '*'.repeat(Math.min(8, value.length - keepTail));
  return `${head}${value.slice(-keepTail)}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function redactValue(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (depth > MAX_REDACT_DEPTH) {
    return '[MaxDepth]';
  }
  const asObject = value as object;
  if (seen.has(asObject)) {
    return '[Circular]';
  }
  seen.add(asObject);

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, seen, depth + 1));
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      ...(value.stack ? { stack: value.stack } : {}),
    };
  }

  if (isPlainObject(value)) {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = SENSITIVE_KEY_PATTERN.test(key)
        ? REDACTED
        : redactValue(item, seen, depth + 1);
    }
    return output;
  }

  return value;
}

/** 递归脱敏：命中敏感键的值整体替换为 `***`；处理循环引用与 Error（保留堆栈）。 */
export function redact<T>(input: T): T {
  if (input === null || typeof input !== 'object') {
    // 顶层裸字符串无法判断语义，按原样返回（调用方应放入具名字段）
    return input;
  }
  return redactValue(input, new WeakSet<object>(), 0) as T;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ level: 'error', msg: '[logger] 日志序列化失败' });
  }
}

function write(level: LogLevel, message: string, fields: LogFields | undefined, context: LogFields): void {
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[currentLevel]) {
    return;
  }
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...(Object.keys(context).length > 0 ? { ctx: redact(context) } : {}),
    ...(fields ? { fields: redact(fields) } : {}),
  };
  const line = `${safeStringify(entry)}\n`;
  if (level === 'warn' || level === 'error') {
    process.stderr.write(line);
  } else {
    process.stdout.write(line);
  }
}

/**
 * 创建日志器；`context` 为固定上下文字段（如 `{ module: 'recommender' }`），会被一并脱敏后输出。
 */
export function createLogger(context: LogFields = {}): Logger {
  return {
    debug: (message, fields) => write('debug', message, fields, context),
    info: (message, fields) => write('info', message, fields, context),
    warn: (message, fields) => write('warn', message, fields, context),
    error: (message, fields) => write('error', message, fields, context),
    child: (extra) => createLogger({ ...context, ...extra }),
  };
}

/** 默认日志器 */
export const logger: Logger = createLogger();
