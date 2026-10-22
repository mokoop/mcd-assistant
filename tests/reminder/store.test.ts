import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError, ErrorCode } from '@/core/errors';
import { logger } from '@/core/logger';
import { createReminderConfigStore } from '@/reminder/config';
import { createReminderStateStore } from '@/reminder/state';
import type { ReminderConfig } from '@/types/index';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mcd-reminder-'));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

function sampleConfig(): ReminderConfig {
  return { mealType: 'lunch', time: '12:00', days: [1, 2, 3, 4, 5], enabled: true, advanceMinutes: 5 };
}

describe('createReminderConfigStore', () => {
  it('文件缺失时返回 undefined（未设定）', async () => {
    const store = createReminderConfigStore(join(dir, 'reminder-config.json'));
    await expect(store.read()).resolves.toBeUndefined();
  });

  it('写入后可原样读回', async () => {
    const store = createReminderConfigStore(join(dir, 'reminder-config.json'));
    await store.write(sampleConfig());
    await expect(store.read()).resolves.toEqual(sampleConfig());
  });

  it('文件损坏时回退 undefined 并告警', async () => {
    const file = join(dir, 'reminder-config.json');
    await mkdir(dir, { recursive: true });
    await writeFile(file, '{ 非法 JSON', 'utf8');
    const warn = vi.spyOn(logger, 'warn');

    await expect(createReminderConfigStore(file).read()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it('结构不合法时回退 undefined 并告警', async () => {
    const file = join(dir, 'reminder-config.json');
    await writeFile(file, JSON.stringify({ mealType: 'lunch', time: '25:99' }), 'utf8');
    const warn = vi.spyOn(logger, 'warn');

    await expect(createReminderConfigStore(file).read()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it('clear 后恢复为未设定', async () => {
    const store = createReminderConfigStore(join(dir, 'reminder-config.json'));
    await store.write(sampleConfig());
    await store.clear();
    await expect(store.read()).resolves.toBeUndefined();
  });

  it('原子写不残留临时文件', async () => {
    const store = createReminderConfigStore(join(dir, 'reminder-config.json'));
    await store.write(sampleConfig());
    expect(await readdir(dir)).toEqual(['reminder-config.json']);
  });

  it('写入非法结构抛 VALIDATION_ERROR', async () => {
    const store = createReminderConfigStore(join(dir, 'reminder-config.json'));
    await expect(store.write({ mealType: 'brunch' } as never)).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
    });
  });

  it('空路径创建抛 VALIDATION_ERROR', () => {
    expect(() => createReminderConfigStore('  ')).toThrow(AppError);
  });
});

describe('createReminderStateStore', () => {
  it('文件缺失时返回空状态', async () => {
    const store = createReminderStateStore(join(dir, 'reminder-state.json'));
    await expect(store.read()).resolves.toEqual({});
  });

  it('markReminded 记录餐次与自然日并持久化', async () => {
    const file = join(dir, 'reminder-state.json');
    const store = createReminderStateStore(file);
    const saved = await store.markReminded('lunch', '2026-10-10', '2026-10-10T12:05:00.000Z');
    expect(saved).toEqual({
      lastRemindedAt: '2026-10-10T12:05:00.000Z',
      lastRemindedMealType: 'lunch',
      lastRemindedDate: '2026-10-10',
    });

    // 重新创建 store（模拟新会话）后仍可读回
    await expect(createReminderStateStore(file).read()).resolves.toEqual(saved);
  });

  it('文件损坏时回退空状态并告警', async () => {
    const file = join(dir, 'reminder-state.json');
    await mkdir(dir, { recursive: true });
    await writeFile(file, 'not json', 'utf8');
    const warn = vi.spyOn(logger, 'warn');
    await expect(createReminderStateStore(file).read()).resolves.toEqual({});
    expect(warn).toHaveBeenCalled();
  });

  it('磁盘内容为格式化 JSON', async () => {
    const file = join(dir, 'reminder-state.json');
    await createReminderStateStore(file).markReminded('dinner', '2026-10-10');
    const raw = await readFile(file, 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(JSON.parse(raw).lastRemindedMealType).toBe('dinner');
  });

  it('并发 markReminded 串行化，最终状态一致', async () => {
    const file = join(dir, 'reminder-state.json');
    const store = createReminderStateStore(file);
    await Promise.all([
      store.markReminded('lunch', '2026-10-10'),
      store.markReminded('dinner', '2026-10-11'),
      store.markReminded('lunch', '2026-10-12'),
    ]);
    const loaded = await store.read();
    expect(loaded.lastRemindedMealType).toBe('lunch');
    expect(loaded.lastRemindedDate).toBe('2026-10-12');
  });
});
