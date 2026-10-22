import { describe, expect, it } from 'vitest';

import { createOfflineProvider } from '@/mcp-client/offline/index';

const query = { storeCode: 'S1', beCode: '2', orderType: 2 as const, beType: 2 };

describe('offline provider', () => {
  it('nowTimeInfo 返回本地时间字段', () => {
    const info = createOfflineProvider().nowTimeInfo();
    expect(info.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(info.dayOfWeek).toBeGreaterThanOrEqual(0);
    expect(info.dayOfWeek).toBeLessThanOrEqual(6);
    expect(info.offset).toMatch(/^[+-]\d{2}:\d{2}$/);
  });

  it('门店/地址/券/营养/活动均返回非空演示数据', () => {
    const provider = createOfflineProvider();
    expect(provider.queryNearbyStores({}).length).toBeGreaterThan(0);
    expect(provider.deliveryQueryAddresses().length).toBeGreaterThan(0);
    expect(provider.deliveryQueryStores({ addressId: 'A001' }).length).toBeGreaterThan(0);
    expect(Object.keys(provider.queryMeals(query).meals).length).toBeGreaterThan(0);
    expect(provider.queryMealDetail({ ...query, code: 'M001' }).name).toBe('巨无霸套餐');
    expect(provider.listNutritionFoods().length).toBeGreaterThan(0);
    expect(provider.availableCoupons().length).toBeGreaterThan(0);
    expect(provider.queryStoreCoupons(query).length).toBeGreaterThan(0);
    expect(provider.queryMyCoupons().length).toBeGreaterThan(0);
    expect(provider.campaignCalendar({}).length).toBeGreaterThan(0);
    expect(provider.autoBindCoupons().length).toBeGreaterThan(0);
  });

  it('价格试算命中券则扣减，未命中则不减', () => {
    const provider = createOfflineProvider();
    const withCoupon = provider.calculatePrice({ ...query, items: [{ productCode: 'M001', quantity: 1, couponCode: 'SAVE5' }] });
    expect(withCoupon.originalPrice).toBe(39);
    expect(withCoupon.price).toBe(34);

    const withoutCoupon = provider.calculatePrice({ ...query, items: [{ productCode: 'M001', quantity: 2 }] });
    expect(withoutCoupon.originalPrice).toBe(78);
    expect(withoutCoupon.discount).toBe(0);
    expect(withoutCoupon.price).toBe(78);
  });
});
