/**
 * 场景模式（v1.1.0 设计 §2.3）—— 以**权重覆盖**实现"一键切换推荐倾向"。
 *
 * 各场景给出一组完整权重（之和=1），便于解释与调参；`auto` 依当前时间自动判定：
 * 22:00–04:59 归为"深夜(late)"，其余时段用基准权重。
 */

import type { RecommenderWeights } from './config.js';
import type { Scene } from '../types/index.js';

/** 实际生效场景（排除 auto） */
export type EffectiveScene = Exclude<Scene, 'auto'>;

/** 场景权重表（每个场景之和 = 1） */
export const SCENE_WEIGHTS: Record<EffectiveScene, RecommenderWeights> = {
  // 快速解决：偏向门店热销 + 基础偏好
  quick: { category: 0.25, price: 0.15, nutrition: 0.08, value: 0.12, novelty: 0.05, taste: 0.1, popularity: 0.25 },
  // 省钱优先：性价比与价格带拉高
  save: { category: 0.2, price: 0.25, nutrition: 0.05, value: 0.35, novelty: 0.05, taste: 0.1, popularity: 0 },
  // 减脂控卡：营养为主导
  fit: { category: 0.15, price: 0.1, nutrition: 0.4, value: 0.1, novelty: 0.1, taste: 0.1, popularity: 0.05 },
  // 犒劳自己：新颖度与口味主导
  treat: { category: 0.25, price: 0.05, nutrition: 0.05, value: 0.05, novelty: 0.3, taste: 0.25, popularity: 0.05 },
  // 深夜：偏向热销与基础偏好
  late: { category: 0.2, price: 0.15, nutrition: 0.1, value: 0.15, novelty: 0.1, taste: 0.1, popularity: 0.2 },
};

/** 场景中文标签 */
export const SCENE_LABELS: Record<EffectiveScene, string> = {
  quick: '快速解决',
  save: '省钱优先',
  fit: '减脂控卡',
  treat: '犒劳自己',
  late: '深夜',
};

/** 深夜判定：22:00–04:59 */
export function isLateNight(hour: number): boolean {
  return hour >= 22 || hour < 5;
}

/** 取某绝对时刻在指定时区下的本地小时（0-23）；时区非法时回退设备时区，再回退 UTC */
export function localHour(now: Date, timeZone?: string): number {
  const zone = resolveZone(timeZone);
  try {
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: '2-digit', hourCycle: 'h23' });
    const part = formatter.formatToParts(now).find((item) => item.type === 'hour');
    const hour = part ? Number(part.value) : NaN;
    if (Number.isFinite(hour)) {
      return ((hour % 24) + 24) % 24;
    }
  } catch {
    // 忽略，走回退
  }
  return now.getHours();
}

function resolveZone(timeZone?: string): string {
  if (timeZone && timeZone.trim().length > 0) {
    return timeZone;
  }
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (resolved && resolved.length > 0) {
      return resolved;
    }
  } catch {
    // 忽略
  }
  return 'UTC';
}

/**
 * 解析实际生效场景：
 * - `auto` → 深夜时段返回 `late`，否则返回 `undefined`（用基准/冷启动权重）；
 * - 已知显式场景 → 原样返回；
 * - 未知取值（运行期传入的非法值）→ 返回 `undefined`（不静默透传非法值）。
 */
export function resolveScene(requested: Scene, now: Date, timeZone?: string): EffectiveScene | undefined {
  if (requested === 'auto') {
    return isLateNight(localHour(now, timeZone)) ? 'late' : undefined;
  }
  return Object.prototype.hasOwnProperty.call(SCENE_WEIGHTS, requested) ? (requested as EffectiveScene) : undefined;
}

/** 取场景权重（无场景时返回 undefined，交由调用方使用基准/冷启动权重） */
export function sceneWeights(scene: EffectiveScene | undefined): RecommenderWeights | undefined {
  return scene ? SCENE_WEIGHTS[scene] : undefined;
}

/** 场景中文标签（无场景或未知取值时返回空串） */
export function sceneLabel(scene: EffectiveScene | undefined): string {
  return scene ? SCENE_LABELS[scene] ?? '' : '';
}

/** 校验场景取值（供 CLI / 编排层使用） */
export const SCENE_VALUES: Scene[] = ['auto', 'quick', 'save', 'fit', 'treat', 'late'];
export function isScene(value: string): value is Scene {
  return (SCENE_VALUES as string[]).includes(value);
}
