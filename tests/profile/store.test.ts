import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError, ErrorCode } from '@/core/errors';
import { logger } from '@/core/logger';
import { createDefaultProfile } from '@/profile/defaults';
import { createProfileStore } from '@/profile/store';
import type { ChoiceRecord } from '@/types/index';

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mcd-profile-'));
  file = join(dir, 'profile.json');
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

function sampleProfile() {
  return {
    ...createDefaultProfile(),
    preferences: {
      categoryWeights: { burger: 1 },
      priceBand: { min: 16, max: 24 },
    },
  };
}

describe('createProfileStore', () => {
  it('写入后可原样读回', async () => {
    const store = createProfileStore(file);
    await store.write(sampleProfile());

    const loaded = await store.read();
    expect(loaded.preferences.categoryWeights).toEqual({ burger: 1 });
    expect(loaded.preferences.priceBand).toEqual({ min: 16, max: 24 });
  });

  it('文件缺失时回退默认空画像', async () => {
    const store = createProfileStore(file);
    const loaded = await store.read();
    expect(loaded.history).toEqual([]);
    expect(loaded.preferences.categoryWeights).toEqual({});
  });

  it('文件损坏时回退默认空画像并告警，不抛错', async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(file, '{ 这不是合法 JSON', 'utf8');
    const warn = vi.spyOn(logger, 'warn');

    const loaded = await createProfileStore(file).read();

    expect(loaded.history).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it('结构合法但字段类型不符时同样回退默认并告警', async () => {
    await writeFile(file, JSON.stringify({ version: 'x', preferences: {} }), 'utf8');
    const warn = vi.spyOn(logger, 'warn');

    const loaded = await createProfileStore(file).read();

    expect(loaded.preferences.categoryWeights).toEqual({});
    expect(warn).toHaveBeenCalled();
  });

  it('原子写不残留临时文件', async () => {
    const store = createProfileStore(file);
    await store.write(sampleProfile());

    const entries = await readdir(dir);
    expect(entries).toEqual(['profile.json']);
  });

  it('磁盘内容为格式化 JSON（可读、可调试）', async () => {
    const store = createProfileStore(file);
    await store.write(sampleProfile());

    const raw = await readFile(file, 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(JSON.parse(raw).preferences.priceBand).toEqual({ min: 16, max: 24 });
  });

  it('写入非法结构时抛出 VALIDATION_ERROR', async () => {
    const store = createProfileStore(file);
    await expect(store.write({ bad: true } as never)).rejects.toBeInstanceOf(AppError);
    await expect(store.write({ bad: true } as never)).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
    });
  });

  it('update 串行化并发读改写，不丢更新', async () => {
    const store = createProfileStore(file);
    await Promise.all(
      Array.from({ length: 20 }, (_, index) => {
        const record: ChoiceRecord = {
          timestamp: new Date().toISOString(),
          storeCode: 'S1',
          mealCode: `M${index}`,
          mealName: '套餐',
          effectivePrice: 10,
          source: 'explicit',
        };
        return store.update((current) => ({ ...current, history: [...current.history, record] }));
      }),
    );

    const loaded = await store.read();
    expect(loaded.history).toHaveLength(20);
  });

  it('空路径创建时抛出 VALIDATION_ERROR', () => {
    expect(() => createProfileStore('  ')).toThrow(AppError);
  });
});
