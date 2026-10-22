/**
 * 提醒文案生成（技术设计 §4.5 / 需求 AC 6.1-1..7）。
 *
 * 根据 `ReminderDecision` 渲染面向用户的提醒 / 引导 / 顺延 / 跳过文案；
 * 时区不一致时在文案中标注判定所用时区（AC 6.1-7）。
 */

import { weekdayLabel } from './time.js';

import type { ReminderDecision } from './judge.js';
import type { MealType } from '../types/index.js';
import type { ReminderConfig } from '../types/index.js';

const MEAL_LABEL: Record<MealType, string> = { lunch: '午餐', dinner: '晚餐' };

/** `buildReminderMessage` 入参 */
export interface ReminderMessageInput {
  decision: ReminderDecision;
  config?: ReminderConfig;
}

/** 格式化生效日：空数组=每天；否则按 周日..周六 升序，如「周一、周三」 */
export function formatActiveDays(days: number[]): string {
  if (days.length === 0) {
    return '每天';
  }
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  return sorted.map((day) => weekdayLabel(day)).join('、');
}

function timezoneNote(decision: ReminderDecision): string {
  return decision.timezoneMismatch ? `（已按你的设备时区 ${decision.timezone} 判定）` : '';
}

/** 未设定提醒时的引导文案（AC 6.1-3：引导设定，不报错） */
export function buildReminderGuideMessage(): string {
  return (
    '你还没有设定就餐提醒。可以告诉我餐次和时间，例如「每天 12:00 提醒我吃午餐」，' +
    '我会在到点提醒你，并顺手推荐一份合适的套餐。'
  );
}

/** 依据判定结果生成提醒文案 */
export function buildReminderMessage(input: ReminderMessageInput): string {
  const { decision, config } = input;
  const label = config ? MEAL_LABEL[config.mealType] : '就餐';

  switch (decision.reason) {
    case 'not-configured':
      return buildReminderGuideMessage();
    case 'disabled':
      return `${label}提醒当前处于关闭状态，需要开启时告诉我即可。`;
    case 'day-inactive': {
      const days = config ? formatActiveDays(config.days) : '指定日期';
      return `今天的${label}提醒未生效（提醒仅设置在 ${days}），今天（${weekdayLabel(decision.dayOfWeek)}）不打扰你。`;
    }
    case 'already-reminded':
      return `${decision.date} 的${label}提醒今天已经发过啦，就不再重复打扰；如果你还想看看套餐推荐，我随时可以帮你再挑一份。`;
    case 'not-due':
      return `${label}提醒设定在 ${decision.scheduledTime ?? ''}，现在 ${decision.nowTime} 还没到点，到点我会提醒你${timezoneNote(decision)}。`;
    case 'quiet-hours':
      return `现在是免打扰时段（${config?.quietHours?.start ?? ''}–${config?.quietHours?.end ?? ''}），${label}提醒已顺延，将在 ${decision.deferredUntil ?? ''} 之后提醒你。`;
    case 'due': {
      const advance = config?.advanceMinutes ?? 0;
      const advanceNote = advance > 0 ? `（按设定提前 ${advance} 分钟）` : '';
      return `🔔 ${label}时间到啦，现在 ${decision.nowTime}${advanceNote}。我这就帮你挑一份合适的套餐～${timezoneNote(decision)}`;
    }
    default:
      return '';
  }
}
