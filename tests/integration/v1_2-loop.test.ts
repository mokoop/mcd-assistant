/**
 * 集成测试 E：v1.2.0 画像纠正/重置、饮食禁忌与过敏原、凑单加购建议。
 */

import { describe, expect, it } from 'vitest';

import { handleRequest } from '@/index';
import { createDefaultProfile } from '@/profile/defaults';
import { recommend } from '@/recommender/index';
import type { MealItem } from '@/types/index';

import { createFakeDeps, testProfile } from '../recommender/fake-deps.js';

import { createSkillDeps } from './helpers.js';

describe('集成 · 饮食禁忌与过敏原（recommender）', () => {
  it('命中过敏原的候选被过滤（保留未命中项）', async () => {
    const { deps } = createFakeDeps();
    const profile = testProfile({
      preferences: {
        categoryWeights: {},
        priceBand: { min: 0, max: 0 },
        dietary: { allergies: ['牛肉'], avoid: [] },
      },
    });
    const result = await recommend({ profile }, deps);
    const codes = [result.recommendation.primary.code, ...result.recommendation.alternatives.map((c) => c.code)];
    // 牛肉：巨无霸(M001)、双层吉士堡(M002) 应被过滤
    expect(codes).not.toContain('M001');
    expect(codes).not.toContain('M002');
    expect(result.dietaryRelaxed).toBe(false);
    expect(result.notices.join('')).toContain('近似筛选');
  });

  it('严格过滤后无可选 → 回退并置 dietaryRelaxed + 强告警', async () => {
    const meals: Record<string, MealItem> = {
      C1: { code: 'C1', name: '麦辣鸡腿堡套餐', price: 35, category: '鸡类' },
      C2: { code: 'C2', name: '香辣鸡翅套餐', price: 30, category: '鸡类' },
    };
    const { deps } = createFakeDeps({
      queryMeals: async () => ({ data: { meals }, degraded: false }),
    });
    const profile = testProfile({
      preferences: { categoryWeights: {}, priceBand: { min: 0, max: 0 }, dietary: { allergies: ['鸡肉'], avoid: [] } },
    });
    const result = await recommend({ profile }, deps);
    expect(result.dietaryRelaxed).toBe(true);
    expect(result.notices.join('')).toContain('无可选');
  });
});

describe('集成 · 凑单加购建议（recommender）', () => {
  it('满减券触发凑单建议（净省 > 0）：主推原价未达门槛', async () => {
    const meals: Record<string, MealItem> = {
      P: { code: 'P', name: '主套餐', price: 28, category: '主' },
      F: { code: 'F', name: '小食', price: 3, category: '配' },
    };
    const { deps } = createFakeDeps({
      queryMeals: async () => ({ data: { meals }, degraded: false }),
      queryStoreCoupons: async () => ({
        data: [{ couponId: 'C1', name: '满30减5', discount: '5' }],
        degraded: false,
      }),
      // 覆盖价格试算：按门槛真实计算（满 30 才减 5），基于本用例自定义菜单
      calculatePrice: async (query) => {
        const original = query.items.reduce(
          (sum, item) => sum + (meals[item.productCode]?.price ?? 0) * item.quantity,
          0,
        );
        const hasCoupon = query.items.some((item) => item.couponId || item.couponCode);
        const discount = hasCoupon && original >= 30 ? 5 : 0;
        return { data: { originalPrice: original, discount, price: Math.max(0, original - discount) }, degraded: false };
      },
    });
    const profile = testProfile({
      preferences: { categoryWeights: { 主: 1 }, priceBand: { min: 0, max: 0 } },
    });
    const result = await recommend({ profile }, deps);
    expect(result.recommendation.primary.code).toBe('P');
    // 原价 28 < 门槛 30 → 券未生效，券后价仍 28；加购 F(3) 后 28+3-5=26，净省 2
    expect(result.recommendation.primary.effectivePrice).toBe(28);
    expect(result.recommendation.bundle?.addCode).toBe('F');
    expect(result.recommendation.bundle?.saved).toBe(2);
  });
});

describe('集成 · 画像纠正/重置（handleRequest）', () => {
  it('reset-profile 未确认 → 不执行并提示确认', async () => {
    let called = 0;
    const { deps } = createSkillDeps({
      resetProfile: async () => {
        called += 1;
        return createDefaultProfile();
      },
    });
    const res = await handleRequest({ action: 'reset-profile' }, deps);
    expect(res.action).toBe('reset-profile');
    expect(called).toBe(0);
    expect(res.text).toContain('重置');
  });

  it('reset-profile 确认 → 执行并返回摘要', async () => {
    let called = 0;
    const { deps } = createSkillDeps({
      resetProfile: async () => {
        called += 1;
        return createDefaultProfile();
      },
    });
    const res = await handleRequest({ action: 'reset-profile', confirmed: true }, deps);
    expect(called).toBe(1);
    expect(res.text).toContain('已重置');
    expect(res.profileSummary).toBeDefined();
  });

  it('configure --clear/--avoid/--allergy → 构造正确的补丁', async () => {
    const patches: unknown[] = [];
    const { deps } = createSkillDeps({
      configureProfile: async (patch) => {
        patches.push(patch);
        return createDefaultProfile();
      },
    });
    await handleRequest(
      { action: 'configure', clearFields: ['taste', 'budget'], allergies: ['乳制品'], avoid: ['牛肉'] },
      deps,
    );
    expect(patches[0]).toMatchObject({
      clear: ['taste', 'budget'],
      dietary: { allergies: ['乳制品'], avoid: ['牛肉'] },
    });
  });
});
