/**
 * 饮食禁忌 / 过敏原（v1.2.0 设计 §2.3）。
 *
 * MCP 无官方成分/过敏原数据，故基于**餐品名称/品类关键词**做**近似筛选**。
 * 免责：可能存在遗漏，严重过敏请务必以麦当劳官方信息 / 门店确认为准。
 *
 * 标签集合与 `profile/onboarding.ts` 的 `DIETARY_TAG_OPTIONS` 保持一致。
 */

/** 饮食规则：标签 ← 命中关键词 / 品类 */
export interface DietaryRule {
  tag: string;
  keywords: string[];
  categories?: string[];
}

/**
 * 饮食规则表（标签集合：牛肉/猪肉/鸡肉/海鲜/乳制品/花生坚果/蛋/大豆）。
 *
 * 关键词为**精确子串**，避免单字误伤（如"牛"不应命中"牛奶"、"豆"不应命中"红豆派"）：
 * - 牛肉：用"牛堡/牛肉/吉士堡/巨无霸/双吉"，**不含**裸"牛"（否则"牛奶/纯牛奶"误判）；
 * - 大豆：用"豆浆/豆奶/豆腐/毛豆/豆制品"，**不含**裸"豆"（否则"红豆派/土豆泥"误判）；
 * - 乳制品：含"奶/芝士/吉士/圣代/新地/甜筒/奶昔/麦旋/冰淇淋/布丁/拿铁/雪糕"。
 */
export const DIETARY_RULES: DietaryRule[] = [
  { tag: '牛肉', keywords: ['牛堡', '牛肉', '吉士堡', '巨无霸', '双吉'] },
  { tag: '猪肉', keywords: ['猪', '培根'] },
  { tag: '鸡肉', keywords: ['鸡', '翅'] },
  { tag: '海鲜', keywords: ['鱼', '虾', '鳕', '蟹'] },
  {
    tag: '乳制品',
    keywords: ['奶', '芝士', '吉士', '圣代', '新地', '甜筒', '奶昔', '麦旋', '冰淇淋', '布丁', '拿铁', '雪糕'],
  },
  { tag: '花生坚果', keywords: ['花生', '坚果', '杏仁'] },
  { tag: '蛋', keywords: ['鸡蛋', '蛋堡', '蛋卷', '蛋挞', '蛋白'] },
  { tag: '大豆', keywords: ['豆浆', '豆奶', '豆腐', '毛豆', '豆制品'] },
];

/** 供 CLI / 校验使用的标签清单 */
export const DIETARY_OPTIONS = DIETARY_RULES.map((rule) => rule.tag);

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, '');
}

/** 由餐品名称与品类推断命中的饮食标签（可能多个） */
export function inferDietaryTags(name: string, category?: string): string[] {
  const normalizedName = normalize(name);
  const normalizedCategory = category ? normalize(category) : '';
  const tags: string[] = [];
  for (const rule of DIETARY_RULES) {
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

/** 该餐品是否命中任一受限标签（忌口 / 过敏原） */
export function matchesDietary(name: string, category: string | undefined, restricted: string[]): boolean {
  if (restricted.length === 0) {
    return false;
  }
  const tags = inferDietaryTags(name, category);
  return tags.some((tag) => restricted.includes(tag));
}
