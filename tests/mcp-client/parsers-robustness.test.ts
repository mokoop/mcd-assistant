import { describe, expect, it } from 'vitest';

import { parseCoupons, parseCampaigns, parseMarkdownTables } from '@/mcp-client/parsers/markdown';
import { parseNutritionFoods, parseToon } from '@/mcp-client/parsers/toon';

/** 对抗性 / 异常输入：解析器必须不抛错（设计 §3.2：解析失败视为空结果并告警、不中断） */
const WEIRD_INPUTS = [
  '',
  '   ',
  '\n\n',
  '```',
  '```toon\n```',
  '这不是结构化内容，只是一段中文说明。',
  '{不是 JSON 也不是 TOON',
  '|',
  '|||',
  '| a |',
  '| a | b |\n| --- |',
  '| 表头1 | 表头2 |\n| --- | --- |',
  'name: "未闭合的引号',
  'a[2]{x,y}:\n  只有一行',
  'a[b]: c',
  '[]:',
  'key:\n      超深缩进',
  '- 顶层列表项',
  '混合 | 竖线 | 文本 | 但没有分隔行',
  '🍔'.repeat(1000),
];

describe('解析器健壮性（不抛错）', () => {
  it.each(WEIRD_INPUTS)('parseToon 不抛错: %j', (input) => {
    expect(() => parseToon(input)).not.toThrow();
  });

  it.each(WEIRD_INPUTS)('parseNutritionFoods 不抛错且返回数组: %j', (input) => {
    let result: ReturnType<typeof parseNutritionFoods> = [];
    expect(() => {
      result = parseNutritionFoods(input);
    }).not.toThrow();
    expect(Array.isArray(result)).toBe(true);
  });

  it.each(WEIRD_INPUTS)('parseMarkdownTables 不抛错且返回数组: %j', (input) => {
    let result: ReturnType<typeof parseMarkdownTables> = [];
    expect(() => {
      result = parseMarkdownTables(input);
    }).not.toThrow();
    expect(Array.isArray(result)).toBe(true);
  });

  it.each(WEIRD_INPUTS)('parseCoupons 不抛错且返回数组: %j', (input) => {
    let result: ReturnType<typeof parseCoupons> = [];
    expect(() => {
      result = parseCoupons(input);
    }).not.toThrow();
    expect(Array.isArray(result)).toBe(true);
  });

  it.each(WEIRD_INPUTS)('parseCampaigns 不抛错且返回数组: %j', (input) => {
    let result: ReturnType<typeof parseCampaigns> = [];
    expect(() => {
      result = parseCampaigns(input);
    }).not.toThrow();
    expect(Array.isArray(result)).toBe(true);
  });
});

describe('畸形但可识别的输入', () => {
  it('空输入返回空结果', () => {
    expect(parseToon('')).toBeNull();
    expect(parseNutritionFoods('')).toEqual([]);
    expect(parseCoupons('')).toEqual([]);
    expect(parseCampaigns('')).toEqual([]);
    expect(parseMarkdownTables('')).toEqual([]);
  });

  it('表格声明了 N 行但行数不足 → 已解析行为准，不报错', () => {
    const result = parseToon('foods[3]{productName,energyKcal}:\n  巨无霸套餐,590');
    expect(result).toEqual({ foods: [{ productName: '巨无霸套餐', energyKcal: 590 }] });
  });

  it('仅表头无分隔行的 Markdown 不误判为表格', () => {
    expect(parseMarkdownTables('| a | b |')).toEqual([]);
    expect(parseCoupons('| a | b |')).toEqual([]);
  });

  it('活动回退：无表格时按标题抽取；纯文本返回空', () => {
    expect(parseCampaigns('# 程序员节活动\n## 第二期').map((c) => c.name)).toEqual(['程序员节活动', '第二期']);
    expect(parseCampaigns('没有标题也没有表格')).toEqual([]);
  });
});
