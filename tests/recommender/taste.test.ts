import { describe, expect, it } from 'vitest';

import { categoriesForTasteTag, inferTasteTags, tasteFit } from '@/recommender/taste';

describe('inferTasteTags（口味关键词映射）', () => {
  it('按名称关键词命中', () => {
    expect(inferTasteTags('麦辣鸡腿堡套餐', '鸡类')).toContain('辣');
    expect(inferTasteTags('麦辣鸡腿堡套餐', '鸡类')).toContain('鸡');
  });

  it('按品类命中（轻食 → 清淡）', () => {
    expect(inferTasteTags('田园沙拉套餐', '轻食')).toContain('清淡');
  });

  it('多标签命中（巨无霸 → 牛）', () => {
    expect(inferTasteTags('巨无霸套餐', '汉堡')).toContain('牛');
  });

  it('无命中返回空数组', () => {
    expect(inferTasteTags('矿泉水', '饮品')).toEqual([]);
  });
});

describe('tasteFit（口味契合度）', () => {
  it('未设偏好或候选无标签 → 中性 0.5', () => {
    expect(tasteFit(['辣'], [])).toBe(0.5);
    expect(tasteFit([], ['辣'])).toBe(0.5);
  });

  it('全覆盖 = 1，无命中 = 0', () => {
    expect(tasteFit(['辣', '鸡'], ['辣'])).toBe(1);
    expect(tasteFit(['鸡'], ['辣'])).toBe(0);
  });

  it('部分命中按比例', () => {
    expect(tasteFit(['辣'], ['辣', '鸡'])).toBeCloseTo(0.5);
  });
});

describe('categoriesForTasteTag', () => {
  it('可枚举品类的标签返回其品类', () => {
    expect(categoriesForTasteTag('清淡')).toContain('轻食');
  });

  it('名称类标签返回空数组', () => {
    expect(categoriesForTasteTag('辣')).toEqual([]);
    expect(categoriesForTasteTag('不存在')).toEqual([]);
  });
});
