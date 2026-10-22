/**
 * 口味标签映射（v1.1.0 设计 §2.3）。
 *
 * MCP 未提供结构化口味字段，故以**名称关键词 / 品类**做近似推断（`inferTasteTags`），
 * 并据此计算口味契合度（`tasteFit`）参与打分。口味为近似推断，输出须标注"仅供参考"。
 *
 * 标签集合与 `profile/onboarding.ts` 的 `TASTE_TAG_OPTIONS` 保持一致。
 */

/** 口味规则：标签 ← 命中关键词 / 品类 */
export interface TasteRule {
  tag: string;
  keywords: string[];
  categories?: string[];
}

/** 口味规则表（标签集合：辣/清淡/甜/鸡/牛/鱼） */
export const TASTE_RULES: TasteRule[] = [
  { tag: '辣', keywords: ['辣'] },
  {
    tag: '清淡',
    keywords: ['沙拉', '板烧', '原味', '麦香', '玉米', '蔬菜', '粥', '轻食'],
    categories: ['轻食', '沙拉', '素食'],
  },
  { tag: '甜', keywords: ['甜', '圣代', '派', '麦旋', '冰淇淋', '奶昔', '布丁'], categories: ['甜品'] },
  { tag: '鸡', keywords: ['鸡', '翅'] },
  { tag: '牛', keywords: ['牛', '吉士', '巨无霸'] },
  { tag: '鱼', keywords: ['鱼'] },
];

/** 规范化：去空白、转小写（中文不受影响） */
function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, '');
}

/**
 * 由餐品名称与品类推断口味标签（可能命中多个）。
 */
export function inferTasteTags(name: string, category?: string): string[] {
  const normalizedName = normalize(name);
  const normalizedCategory = category ? normalize(category) : '';
  const tags: string[] = [];
  for (const rule of TASTE_RULES) {
    const byKeyword = rule.keywords.some((keyword) => normalizedName.includes(normalize(keyword)));
    const byCategory =
      normalizedCategory.length > 0 &&
      (rule.categories ?? []).some((item) => normalizedCategory.includes(normalize(item)));
    if (byKeyword || byCategory) {
      tags.push(rule.tag);
    }
  }
  return tags;
}

/**
 * 口味契合度（0~1）：
 * - 未设置偏好 或 候选无标签 → 中性 0.5（不惩罚未知，避免冷启动误伤）；
 * - 否则 = 命中偏好数 / 偏好总数。
 */
export function tasteFit(candidateTags: string[], preferredTags: string[]): number {
  if (preferredTags.length === 0 || candidateTags.length === 0) {
    return 0.5;
  }
  const hit = preferredTags.filter((tag) => candidateTags.includes(tag)).length;
  return Math.min(1, Math.max(0, hit / preferredTags.length));
}

/**
 * 返回某口味标签对应的**可枚举品类**（用于"口味纠偏"时对该品类记负反馈）。
 * 名称类标签（如"辣/鸡/牛/鱼"）无固定品类，返回空数组（仅移除标签即可）。
 */
export function categoriesForTasteTag(tag: string): string[] {
  const rule = TASTE_RULES.find((item) => item.tag === tag);
  return rule?.categories ?? [];
}
