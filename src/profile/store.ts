/**
 * 画像本地持久化（技术设计 §2.2）。
 *
 * 设计要点：
 * - **原子写**：先写同目录临时文件，再 `rename` 原子替换，避免写一半损坏原文件；
 * - **单写者**：同一 store 实例内的写/读改写操作串行化（promise 队列），避免并发交错；
 * - **损坏恢复**：读取/解析失败 → 回退默认空画像并告警，**不抛错**，下次写入重建。
 *
 * 说明：并发保护针对单进程；跨进程并发写不在本期范围（无后台常驻进程，符合需求 §7）。
 */

import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { AppError, ErrorCode } from '../core/errors.js';
import { logger } from '../core/logger.js';

import { createDefaultProfile } from './defaults.js';
import { parseUserProfile } from './schema.js';

import type { UserProfile } from '../types/index.js';

/** 画像存储接口 */
export interface ProfileStore {
  /** 画像文件绝对/相对路径 */
  readonly filePath: string;
  /** 读取画像；缺失或损坏时回退默认空画像 */
  read(): Promise<UserProfile>;
  /** 覆盖写入画像（原子写、单写者） */
  write(profile: UserProfile): Promise<void>;
  /** 读改写：以当前画像为输入计算新画像并原子落盘，返回落盘结果 */
  update(updater: (current: UserProfile) => UserProfile): Promise<UserProfile>;
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
 * 创建画像存储实例。
 * @param filePath 画像文件路径（如 `data/profile.json`）
 */
export function createProfileStore(filePath: string): ProfileStore {
  if (filePath.trim().length === 0) {
    throw new AppError({ code: ErrorCode.VALIDATION_ERROR, message: '画像文件路径不能为空' });
  }

  // 单写者队列：保证同一实例的写操作串行执行
  let chain: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const result = chain.then(task, task);
    chain = result.catch(() => undefined);
    return result;
  };

  const readDirect = async (): Promise<UserProfile> => {
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf8');
    } catch (error) {
      if (isEnoent(error)) {
        logger.debug('画像文件不存在，使用默认空画像', { filePath });
      } else {
        logger.error('画像文件读取失败，回退默认空画像', { filePath, error });
      }
      return createDefaultProfile();
    }
    try {
      return parseUserProfile(JSON.parse(raw));
    } catch (error) {
      logger.warn('画像文件损坏或格式不符，回退默认空画像', { filePath, error });
      return createDefaultProfile();
    }
  };

  const writeDirect = async (profile: UserProfile): Promise<UserProfile> => {
    let validated: UserProfile;
    try {
      validated = parseUserProfile(profile);
    } catch (error) {
      throw new AppError({
        code: ErrorCode.VALIDATION_ERROR,
        message: '画像数据结构非法，拒绝写入',
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
        message: '画像写入失败',
        cause: error,
        details: { filePath },
      });
    }
    return validated;
  };

  return {
    filePath,
    read: (): Promise<UserProfile> => readDirect(),
    write: (profile: UserProfile): Promise<void> => enqueue(() => writeDirect(profile)).then(() => undefined),
    update: (updater: (current: UserProfile) => UserProfile): Promise<UserProfile> =>
      enqueue(async () => {
        const current = await readDirect();
        const next = updater(current);
        return writeDirect({ ...next, updatedAt: new Date().toISOString() });
      }),
  };
}
