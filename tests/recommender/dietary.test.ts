import { describe, expect, it } from 'vitest';

import { DIETARY_TAG_OPTIONS } from '@/profile/onboarding';
import { DIETARY_OPTIONS, inferDietaryTags, matchesDietary } from '@/recommender/dietary';

describe('inferDietaryTags（饮食标签近似推断）', () => {
  it('按名称关键词命中', () => {
    expect(inferDietaryTags('巨无霸套餐', '汉堡')).toContain('牛肉');
    expect(inferDietaryTags('麦辣鸡腿堡套餐', '鸡类')).toContain('鸡肉');
    expect(inferDietaryTags('拿铁', '饮品')).toContain('乳制品');
  });

  it('可命中多个标签', () => {
    const tags = inferDietaryTags('双层吉士堡套餐', '汉堡');
    expect(tags).toEqual(expect.arrayContaining(['牛肉', '乳制品']));
  });

  it('无命中返回空数组', () => {
    expect(inferDietaryTags('矿泉水', '饮品')).toEqual([]);
  });

  it('单字关键词不误伤（负例）', () => {
    expect(inferDietaryTags('纯牛奶', '饮品')).toEqual(['乳制品']); // 不含"牛肉"
    expect(inferDietaryTags('红豆派', '甜品')).toEqual([]); // 不含"大豆"
    expect(inferDietaryTags('土豆泥', '配菜')).toEqual([]);
  });

  it('乳制品别名可命中', () => {
    expect(inferDietaryTags('新地', '甜品')).toContain('乳制品');
    expect(inferDietaryTags('甜筒', '甜品')).toContain('乳制品');
  });
});

describe('matchesDietary', () => {
  it('命中受限标签为 true', () => {
    expect(matchesDietary('巨无霸套餐', '汉堡', ['牛肉'])).toBe(true);
  });

  it('未命中或空限制为 false', () => {
    expect(matchesDietary('巨无霸套餐', '汉堡', ['海鲜'])).toBe(false);
    expect(matchesDietary('巨无霸套餐', '汉堡', [])).toBe(false);
  });
});

describe('DIETARY_OPTIONS', () => {
  it('包含常用标签', () => {
    expect(DIETARY_OPTIONS).toEqual(
      expect.arrayContaining(['牛肉', '猪肉', '鸡肉', '海鲜', '乳制品', '花生坚果', '蛋', '大豆']),
    );
  });

  it('与 onboarding 白名单一致（防清单漂移）', () => {
    expect([...DIETARY_OPTIONS]).toEqual([...DIETARY_TAG_OPTIONS]);
  });
});
