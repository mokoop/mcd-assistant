import { describe, expect, it } from 'vitest';

import { buildHostScheduleSuggestion } from '@/reminder/schedule';
import type { ReminderConfig } from '@/types/index';

function config(overrides: Partial<ReminderConfig> = {}): ReminderConfig {
  return { mealType: 'lunch', time: '12:00', days: [], enabled: true, ...overrides };
}

describe('buildHostScheduleSuggestion', () => {
  it('每天提醒生成 cron', () => {
    const suggestion = buildHostScheduleSuggestion(config());
    expect(suggestion.available).toBe(true);
    expect(suggestion.mode).toBe('host-cron');
    expect(suggestion.cronExpression).toBe('0 12 * * *');
    expect(suggestion.triggerTime).toBe('12:00');
  });

  it('提前提醒体现在 cron 分钟上', () => {
    const suggestion = buildHostScheduleSuggestion(config({ advanceMinutes: 10 }));
    expect(suggestion.cronExpression).toBe('50 11 * * *');
    expect(suggestion.triggerTime).toBe('11:50');
  });

  it('指定生效日映射为 cron day-of-week', () => {
    const suggestion = buildHostScheduleSuggestion(config({ days: [3, 1, 1] }));
    expect(suggestion.cronExpression).toBe('0 12 * * 1,3');
  });

  it('保留配置时区', () => {
    const suggestion = buildHostScheduleSuggestion(config({ timezone: 'Asia/Shanghai' }));
    expect(suggestion.timezone).toBe('Asia/Shanghai');
  });

  it('未配置或已关闭时降级为对话触发式', () => {
    expect(buildHostScheduleSuggestion(undefined)).toMatchObject({ available: false, mode: 'dialog-triggered' });
    expect(buildHostScheduleSuggestion(config({ enabled: false }))).toMatchObject({
      available: false,
      mode: 'dialog-triggered',
    });
  });

  it('时间非法时不抛错，降级为对话触发式', () => {
    const suggestion = buildHostScheduleSuggestion(config({ time: '99:99' }));
    expect(suggestion.available).toBe(false);
    expect(suggestion.mode).toBe('dialog-triggered');
  });
});
