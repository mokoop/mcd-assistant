import { isAbsolute, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveDataDir, resolveDataPath } from '@/core/paths';
import { resolveReminderConfigPath, resolveReminderStatePath } from '@/reminder/config';

const REAL_ARGV1 = process.argv[1];

afterEach(() => {
  process.argv[1] = REAL_ARGV1;
  vi.unstubAllEnvs();
});

describe('resolveDataDir（仅识别自身 CLI 入口）', () => {
  it('技能布局 <skillDir>/scripts/mcd-meal.mjs → <skillDir>/data', () => {
    process.argv[1] = join('/tmp/proj/skill', 'scripts', 'mcd-meal.mjs');
    expect(resolveDataDir()).toBe(join('/tmp/proj/skill', 'data'));
  });

  it('源码布局 <repo>/dist/cli.js → <repo>/data', () => {
    process.argv[1] = join('/tmp/proj/repo', 'dist', 'cli.js');
    expect(resolveDataDir()).toBe(join('/tmp/proj/repo', 'data'));
  });

  it('codex/opencode 布局 <agentDir>/mcd-meal/mcd-meal.mjs → <agentDir>/mcd-meal/data', () => {
    process.argv[1] = join('/tmp/proj/.codex', 'mcd-meal', 'mcd-meal.mjs');
    expect(resolveDataDir()).toBe(join('/tmp/proj/.codex', 'mcd-meal', 'data'));
  });

  it('非本 CLI 入口（bin shim / 库宿主）→ 回退 CWD/data（不写 node_modules）', () => {
    process.argv[1] = join('/tmp/proj/node_modules', '.bin', 'mcd-meal');
    expect(resolveDataDir()).toBe(join(process.cwd(), 'data'));

    process.argv[1] = '/tmp/proj/someapp/server.mjs';
    expect(resolveDataDir()).toBe(join(process.cwd(), 'data'));
  });

  it('目录入口（node .）→ 回退 CWD/data', () => {
    process.argv[1] = '/tmp/proj/pkg';
    expect(resolveDataDir()).toBe(join(process.cwd(), 'data'));
  });
});

describe('resolveDataDir / resolveDataPath（MCD_DATA_DIR 覆盖）', () => {
  it('绝对路径直接使用', () => {
    vi.stubEnv('MCD_DATA_DIR', '/tmp/mcd-data');
    expect(resolveDataDir()).toBe('/tmp/mcd-data');
    expect(resolveDataPath('x.json')).toBe('/tmp/mcd-data/x.json');
  });

  it('相对路径归一化为绝对（不再随 CWD 漂移）', () => {
    vi.stubEnv('MCD_DATA_DIR', 'rel-data');
    const dir = resolveDataDir();
    expect(isAbsolute(dir)).toBe(true);
    expect(dir).toBe(join(process.cwd(), 'rel-data'));
  });
});

describe('reminder 路径同样锚定且尊重传入 env', () => {
  it('MCD_DATA_DIR 生效，且专用变量优先', () => {
    expect(resolveReminderConfigPath({ MCD_DATA_DIR: '/tmp/mcd-data' })).toBe('/tmp/mcd-data/reminder-config.json');
    expect(resolveReminderStatePath({ MCD_DATA_DIR: '/tmp/mcd-data' })).toBe('/tmp/mcd-data/reminder-state.json');
    expect(
      resolveReminderConfigPath({ MCD_DATA_DIR: '/tmp/mcd-data', MCD_REMINDER_CONFIG_PATH: '/tmp/c.json' }),
    ).toBe('/tmp/c.json');
  });
});
