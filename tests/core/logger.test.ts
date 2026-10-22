import { describe, expect, it } from 'vitest';

import { mask, redact } from '@/core/logger';

describe('mask', () => {
  it('保留末位并以 * 覆盖其余部分', () => {
    expect(mask('abcdefghij', 4)).toBe('******ghij');
  });

  it('空串返回空串', () => {
    expect(mask('', 4)).toBe('');
  });

  it('长度不足以保留末位时整体遮蔽', () => {
    expect(mask('abc', 4)).toBe('***');
  });
});

describe('redact', () => {
  it('对敏感键整体脱敏', () => {
    const input = {
      module: 'mcp',
      token: 'super-secret-token',
      phone: '13800138000',
      nested: { authorization: 'Bearer abc', address: '上海市某路 1 号' },
    };

    const output = redact(input) as Record<string, unknown>;
    expect(output.module).toBe('mcp');
    expect(output.token).toBe('***');
    expect(output.phone).toBe('***');
    expect(output.nested).toEqual({ authorization: '***', address: '***' });
  });

  it('对普通字段保持原值并递归数组', () => {
    const input = { items: [{ code: 'M001', token: 'x' }], count: 2 };
    expect(redact(input)).toEqual({ items: [{ code: 'M001', token: '***' }], count: 2 });
  });

  it('处理循环引用不抛错', () => {
    const node: Record<string, unknown> = { name: 'root' };
    node.self = node;
    const output = redact(node) as Record<string, unknown>;
    expect(output.name).toBe('root');
    expect(output.self).toBe('[Circular]');
  });

  it('Error 保留名称与消息', () => {
    const output = redact(new Error('boom')) as unknown as Record<string, unknown>;
    expect(output.name).toBe('Error');
    expect(output.message).toBe('boom');
  });
});
