/**
 * 提醒配置的默认值、路径解析与持久化（技术设计 §2.2 / §4.4）。
 *
 * 说明：设计 §2.2 仅枚举了 `data/profile.json` 与 `data/reminder-state.json`，
 * 未单列「提醒配置」文件；本实现为让 `setReminder` / `getReminderConfig` 在会话间生效，
 * 将配置持久化到 `data/reminder-config.json`（同样被 `.gitignore` 忽略、原子写）。
 */

import { resolveDataPath } from '../core/paths.js';

import { parseReminderConfig } from './schema.js';
import { createJsonStore, type JsonStore } from './store.js';

import type { ReminderConfigInput } from './schema.js';
import type { ReminderConfig } from '../types/index.js';

/** 解析提醒配置文件路径（`MCD_REMINDER_CONFIG_PATH` 优先；否则 <数据目录>/reminder-config.json） */
export function resolveReminderConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.MCD_REMINDER_CONFIG_PATH?.trim();
  return raw && raw.length > 0 ? raw : resolveDataPath('reminder-config.json', env);
}

/** 解析提醒状态文件路径（`MCD_REMINDER_STATE_PATH` 优先；否则 <数据目录>/reminder-state.json） */
export function resolveReminderStatePath(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.MCD_REMINDER_STATE_PATH?.trim();
  return raw && raw.length > 0 ? raw : resolveDataPath('reminder-state.json', env);
}

/** 提醒配置存储接口 */
export interface ReminderConfigStore {
  readonly filePath: string;
  /** 读取配置；未设定 / 损坏时返回 `undefined`（不报错） */
  read(): Promise<ReminderConfig | undefined>;
  /** 覆盖写入配置（原子写、单写者） */
  write(config: ReminderConfig): Promise<ReminderConfig>;
  /** 清除配置（恢复为「未设定」） */
  clear(): Promise<void>;
}

/** 创建提醒配置存储 */
export function createReminderConfigStore(filePath: string): ReminderConfigStore {
  const store: JsonStore<ReminderConfig> = createJsonStore<ReminderConfig>({
    filePath,
    label: '提醒配置',
    parse: parseReminderConfig,
    fallback: () => undefined,
    validate: parseReminderConfig,
  });
  return {
    filePath: store.filePath,
    read: (): Promise<ReminderConfig | undefined> => store.read(),
    write: (config: ReminderConfig): Promise<ReminderConfig> => store.write(config),
    clear: (): Promise<void> => store.clear(),
  };
}

let defaultConfigStore: ReminderConfigStore | undefined;

/** 默认配置存储（惰性创建，路径经环境变量解析） */
function getDefaultConfigStore(): ReminderConfigStore {
  defaultConfigStore ??= createReminderConfigStore(resolveReminderConfigPath());
  return defaultConfigStore;
}

/**
 * 设定提醒配置：zod 校验通过后原子落盘；非法输入抛 `AppError(VALIDATION_ERROR)`，**不写入**（AC 6.6）。
 */
export async function setReminder(
  input: ReminderConfigInput,
  store?: ReminderConfigStore,
): Promise<ReminderConfig> {
  const config = parseReminderConfig(input);
  return (store ?? getDefaultConfigStore()).write(config);
}

/** 读取提醒配置；未设定时返回 `undefined`（AC 6.1-3：引导用户设定，不报错） */
export async function getReminderConfig(store?: ReminderConfigStore): Promise<ReminderConfig | undefined> {
  return (store ?? getDefaultConfigStore()).read();
}

/** 清除提醒配置 */
export async function clearReminder(store?: ReminderConfigStore): Promise<void> {
  await (store ?? getDefaultConfigStore()).clear();
}
