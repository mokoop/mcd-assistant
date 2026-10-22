/**
 * reminder 模块通用 JSON 持久化（技术设计 §2.2）。
 *
 * 复用与 `src/profile/store.ts` 一致的原子写 / 单写者 / 损坏回退策略：
 * - **原子写**：先写同目录临时文件，再 `rename` 原子替换，避免写一半损坏原文件；
 * - **单写者**：同一 store 实例内的写 / 读改写操作串行化（promise 队列），避免并发交错；
 * - **损坏恢复**：读取 / 解析失败 → 回退默认值并告警，**不抛错**，下次写入重建。
 *
 * 模块边界：本文件仅依赖 `src/core`，**不依赖 profile / recommender**，
 * 因此独立实现而非复用 profile 的 store。
 */

import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { AppError, ErrorCode } from '../core/errors.js';
import { logger } from '../core/logger.js';

/** `createJsonStore` 选项 */
export interface JsonStoreOptions<T> {
  /** 存储文件路径（如 `data/reminder-state.json`） */
  filePath: string;
  /** 解析已读取的原始 JSON；抛错表示文件损坏 */
  parse: (raw: unknown) => T;
  /** 文件缺失或损坏时的回退值（`undefined` 表示「未配置」） */
  fallback: () => T | undefined;
  /** 写入前校验 / 归一化；抛错则拒绝写入 */
  validate?: (value: T) => T;
  /** 日志与错误提示用的中文标签，如「提醒状态」 */
  label: string;
}

/** 通用 JSON 存储接口 */
export interface JsonStore<T> {
  readonly filePath: string;
  /** 读取；缺失 / 损坏时返回回退值 */
  read(): Promise<T | undefined>;
  /** 覆盖写入（原子写、单写者） */
  write(value: T): Promise<T>;
  /** 读改写：以当前值为输入计算新值并原子落盘，返回落盘结果 */
  update(updater: (current: T | undefined) => T): Promise<T>;
  /** 删除存储文件（用于清除配置等场景） */
  clear(): Promise<void>;
}

function isEnoent(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

/**
 * 创建通用 JSON 存储。
 * @param options 存储选项（路径 / 解析 / 回退 / 校验 / 标签）
 */
export function createJsonStore<T>(options: JsonStoreOptions<T>): JsonStore<T> {
  const { filePath, parse, fallback, label } = options;
  const validate = options.validate ?? ((value: T): T => value);

  if (filePath.trim().length === 0) {
    throw new AppError({ code: ErrorCode.VALIDATION_ERROR, message: `${label}文件路径不能为空` });
  }

  // 单写者队列：保证同一实例的写操作串行执行
  let chain: Promise<unknown> = Promise.resolve();
  const enqueue = <R>(task: () => Promise<R>): Promise<R> => {
    const result = chain.then(task, task);
    chain = result.catch(() => undefined);
    return result;
  };

  const readDirect = async (): Promise<T | undefined> => {
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf8');
    } catch (error) {
      if (isEnoent(error)) {
        logger.debug(`${label}文件不存在，使用回退值`, { filePath });
      } else {
        logger.error(`${label}文件读取失败，使用回退值`, { filePath, error });
      }
      return fallback();
    }
    try {
      return parse(JSON.parse(raw));
    } catch (error) {
      logger.warn(`${label}文件损坏或格式不符，使用回退值`, { filePath, error });
      return fallback();
    }
  };

  const writeDirect = async (value: T): Promise<T> => {
    let validated: T;
    try {
      validated = validate(value);
    } catch (error) {
      throw new AppError({
        code: ErrorCode.VALIDATION_ERROR,
        message: `${label}数据结构非法，拒绝写入`,
        cause: error,
      });
    }
    const tempPath = `${filePath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(tempPath, `${JSON.stringify(validated, null, 2)}\n`, 'utf8');
      // rename 在同一文件系统内为原子操作：读取方看到的要么是旧文件，要么是新文件
      await rename(tempPath, filePath);
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => undefined);
      throw new AppError({
        code: ErrorCode.IO_ERROR,
        message: `${label}写入失败`,
        cause: error,
        details: { filePath },
      });
    }
    return validated;
  };

  return {
    filePath,
    read: (): Promise<T | undefined> => readDirect(),
    write: (value: T): Promise<T> => enqueue(() => writeDirect(value)),
    update: (updater: (current: T | undefined) => T): Promise<T> =>
      enqueue(async () => writeDirect(updater(await readDirect()))),
    clear: (): Promise<void> =>
      enqueue(async () => {
        await rm(filePath, { force: true });
      }),
  };
}
