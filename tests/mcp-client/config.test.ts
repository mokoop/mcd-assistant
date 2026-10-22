import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG, loadConfig } from '@/mcp-client/config';

describe('loadConfig', () => {
  it('未设置环境变量时回退默认值', () => {
    const config = loadConfig({});
    expect(config.offline).toBe(false);
    expect(config.token).toBeUndefined();
    expect(config.timeoutMs).toBe(DEFAULT_CONFIG.timeoutMs);
    expect(config.baseUrl).toBe('https://mcp.mcd.cn');
  });

  it('MCD_OFFLINE=1 开启离线', () => {
    expect(loadConfig({ MCD_OFFLINE: '1' }).offline).toBe(true);
    expect(loadConfig({ MCD_OFFLINE: '0' }).offline).toBe(false);
  });

  it('空白 Token 视为未配置', () => {
    expect(loadConfig({ MCD_MCP_TOKEN: '   ' }).token).toBeUndefined();
    expect(loadConfig({ MCD_MCP_TOKEN: 'abc' }).token).toBe('abc');
  });
});
