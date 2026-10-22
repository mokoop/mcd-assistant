import { describe, expect, it } from 'vitest';

import { createMcpClient } from '@/mcp-client/tools';

const base = { storeCode: 'S1', beCode: '2', orderType: 2 as const, beType: 2 };

describe('离线模式：全部工具走通的降级数据', () => {
  it('所有工具均返回 degraded=true 且数据非空', async () => {
    const client = createMcpClient({ config: { offline: true } });
    const results = await Promise.all([
      client.nowTimeInfo(),
      client.queryNearbyStores({ city: '上海' }),
      client.deliveryQueryAddresses(),
      client.deliveryQueryStores({ addressId: 'A001' }),
      client.queryMeals(base),
      client.queryMealDetail({ ...base, code: 'M001' }),
      client.listNutritionFoods(),
      client.availableCoupons(),
      client.queryStoreCoupons(base),
      client.queryMyCoupons(),
      client.calculatePrice({ ...base, items: [{ productCode: 'M001', quantity: 1 }] }),
      client.campaignCalendar(),
      client.autoBindCoupons(),
    ]);
    for (const result of results) {
      expect(result.degraded).toBe(true);
    }
    expect(results[0].data.datetime).toBeTruthy();
    expect(results[1].data.length).toBeGreaterThan(0);
    expect(Object.keys(results[4].data.meals).length).toBeGreaterThan(0);
    expect(results[6].data.length).toBeGreaterThan(0);
    expect(results[10].data.price).toBe(39);
    await client.close();
  });
});
