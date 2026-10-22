import { isAbsolute } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_PROFILE_CONFIG, resolveProfileConfig, resolveProfileFilePath } from '@/profile/config';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resolveProfileFilePath', () => {
  it('缺省锚定运行根目录 data/profile.json（绝对路径，v1.3.0）', () => {
    const resolved = resolveProfileFilePath();
    expect(isAbsolute(resolved)).toBe(true);
    expect(resolved.endsWith(`${'data'}/profile.json`)).toBe(true);
  });

  it('通过 MCD_PROFILE_PATH 覆盖', () => {
    vi.stubEnv('MCD_PROFILE_PATH', '/tmp/custom/profile.json');
    expect(resolveProfileFilePath()).toBe('/tmp/custom/profile.json');
  });

  it('通过 MCD_DATA_DIR 改变默认目录', () => {
    vi.stubEnv('MCD_DATA_DIR', '/tmp/mcd-data');
    expect(resolveProfileFilePath()).toBe('/tmp/mcd-data/profile.json');
  });
});

describe('resolveProfileConfig', () => {
  it('缺省返回设计约定的默认系数', () => {
    const config = resolveProfileConfig();
    expect(config.alphaStrong).toBe(0.4);
    expect(config.alphaWeak).toBe(0.15);
    expect(config.historyLimit).toBe(50);
  });

  it('环境变量可覆盖 EMA 系数与 history 上限', () => {
    vi.stubEnv('MCD_PROFILE_ALPHA_STRONG', '0.5');
    vi.stubEnv('MCD_PROFILE_ALPHA_WEAK', '0.2');
    vi.stubEnv('MCD_PROFILE_HISTORY_LIMIT', '20');

    const config = resolveProfileConfig();
    expect(config.alphaStrong).toBe(0.5);
    expect(config.alphaWeak).toBe(0.2);
    expect(config.historyLimit).toBe(20);
  });

  it('非法环境变量值回退默认', () => {
    vi.stubEnv('MCD_PROFILE_ALPHA_STRONG', '2');
    vi.stubEnv('MCD_PROFILE_HISTORY_LIMIT', '0');

    const config = resolveProfileConfig();
    expect(config.alphaStrong).toBe(DEFAULT_PROFILE_CONFIG.alphaStrong);
    expect(config.historyLimit).toBe(DEFAULT_PROFILE_CONFIG.historyLimit);
  });

  it('时区缺省为 undefined（由 deriveTimeSlot 取设备时区），可经 MCD_PROFILE_TIMEZONE 覆盖', () => {
    vi.stubEnv('MCD_PROFILE_TIMEZONE', '');
    expect(resolveProfileConfig().timeZone).toBeUndefined();

    vi.stubEnv('MCD_PROFILE_TIMEZONE', 'Asia/Shanghai');
    expect(resolveProfileConfig().timeZone).toBe('Asia/Shanghai');
  });

  it('overrides 优先级最高', () => {
    vi.stubEnv('MCD_PROFILE_ALPHA_STRONG', '0.5');
    const config = resolveProfileConfig({ alphaStrong: 0.9 });
    expect(config.alphaStrong).toBe(0.9);
  });
});
