/**
 * 提醒状态持久化（去重，技术设计 §2.2 / §4.4）。
 *
 * `data/reminder-state.json` 记录最近一次提醒的时间 / 餐次 / 自然日，
 * 用于「同一餐次、同一自然日不重复提醒」（需求 AC 6.1-2）；
 * 原子写、单写者、损坏回退，语义同 `src/profile/store.ts`。
 */

import { resolveReminderStatePath } from './config.js';
import { parseReminderState } from './schema.js';
import { createJsonStore } from './store.js';

import type { MealType, ReminderState } from '../types/index.js';

/** 提醒状态存储接口 */
export interface ReminderStateStore {
  readonly filePath: string;
  /** 读取状态；缺失 / 损坏时返回空状态（不报错） */
  read(): Promise<ReminderState>;
  /** 覆盖写入状态（原子写） */
  write(state: ReminderState): Promise<ReminderState>;
  /** 读改写（原子、单写者） */
  update(updater: (current: ReminderState) => ReminderState): Promise<ReminderState>;
  /** 记录一次已提醒（写入餐次与自然日） */
  markReminded(mealType: MealType, date: string, at?: string): Promise<ReminderState>;
}

/** 创建提醒状态存储 */
export function createReminderStateStore(filePath: string): ReminderStateStore {
  const store = createJsonStore<ReminderState>({
    filePath,
    label: '提醒状态',
    parse: parseReminderState,
    fallback: () => ({}),
    validate: parseReminderState,
  });
  return {
    filePath: store.filePath,
    read: async (): Promise<ReminderState> => (await store.read()) ?? {},
    write: (state: ReminderState): Promise<ReminderState> => store.write(state),
    update: (updater: (current: ReminderState) => ReminderState): Promise<ReminderState> =>
      store.update((current) => updater(current ?? {})),
    markReminded: (mealType: MealType, date: string, at?: string): Promise<ReminderState> =>
      store.update(() => ({
        lastRemindedAt: at ?? new Date().toISOString(),
        lastRemindedMealType: mealType,
        lastRemindedDate: date,
      })),
  };
}

let defaultStateStore: ReminderStateStore | undefined;

/** 默认状态存储（惰性创建，路径经环境变量解析） */
function getDefaultStateStore(): ReminderStateStore {
  defaultStateStore ??= createReminderStateStore(resolveReminderStatePath());
  return defaultStateStore;
}

/** 读取提醒状态；未设定 / 损坏时返回空状态 */
export async function readReminderState(store?: ReminderStateStore): Promise<ReminderState> {
  return (store ?? getDefaultStateStore()).read();
}

/** 保存提醒状态（原子写） */
export async function saveReminderState(
  state: ReminderState,
  store?: ReminderStateStore,
): Promise<ReminderState> {
  return (store ?? getDefaultStateStore()).write(state);
}

/** 记录一次已提醒（供触发后持久化去重状态） */
export async function markReminded(
  mealType: MealType,
  date: string,
  at?: string,
  store?: ReminderStateStore,
): Promise<ReminderState> {
  return (store ?? getDefaultStateStore()).markReminded(mealType, date, at);
}
