import { describe, expect, it } from 'vitest';

import { AppError, ErrorCode } from '@/core/errors';
import { parseReminderConfig, parseReminderState } from '@/reminder/schema';

function expectValidationError(run: () => unknown): AppError {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(AppError);
  const appError = caught as AppError;
  expect(appError.code).toBe(ErrorCode.VALIDATION_ERROR);
  return appError;
}

describe('parseReminderConfig', () => {
  it('合法配置应用默认值', () => {
    const parsed = parseReminderConfig({ mealType: 'lunch', time: '12:00' });
    expect(parsed).toEqual({ mealType: 'lunch', time: '12:00', days: [], enabled: true });
  });

  it('保留可选字段', () => {
    const parsed = parseReminderConfig({
      mealType: 'dinner',
      time: '18:30',
      days: [1, 3, 5],
      enabled: true,
      advanceMinutes: 10,
      quietHours: { start: '12:00', end: '13:00' },
      timezone: 'Asia/Shanghai',
    });
    expect(parsed.days).toEqual([1, 3, 5]);
    expect(parsed.advanceMinutes).toBe(10);
    expect(parsed.quietHours).toEqual({ start: '12:00', end: '13:00' });
  });

  it('非法时间格式被拒绝且提示格式（AC 6.6-1）', () => {
    const error = expectValidationError(() => parseReminderConfig({ mealType: 'lunch', time: '25:99' }));
    expect(error.message).toContain('时间格式');
  });

  it('非法 mealType 被拒绝', () => {
    const error = expectValidationError(() => parseReminderConfig({ mealType: 'breakfast', time: '12:00' }));
    expect(error.message).toContain('餐次');
  });

  it('生效日越界被拒绝', () => {
    expectValidationError(() => parseReminderConfig({ mealType: 'lunch', time: '12:00', days: [7] }));
  });

  it('负数提前分钟被拒绝', () => {
    expectValidationError(() => parseReminderConfig({ mealType: 'lunch', time: '12:00', advanceMinutes: -1 }));
  });

  it('非法免打扰时间被拒绝', () => {
    expectValidationError(() =>
      parseReminderConfig({ mealType: 'lunch', time: '12:00', quietHours: { start: '9:00', end: '13:00' } }),
    );
  });
});

describe('parseReminderState', () => {
  it('合法状态通过', () => {
    const parsed = parseReminderState({
      lastRemindedAt: '2026-10-10T12:05:00.000Z',
      lastRemindedMealType: 'lunch',
      lastRemindedDate: '2026-10-10',
    });
    expect(parsed.lastRemindedDate).toBe('2026-10-10');
  });

  it('空对象通过', () => {
    expect(parseReminderState({})).toEqual({});
  });

  it('非法日期被拒绝', () => {
    expectValidationError(() => parseReminderState({ lastRemindedDate: '2026/10/10' }));
  });
});
