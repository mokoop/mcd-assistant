import { describe, expect, it } from 'vitest';

import { channelOrderParams, resolveChannel } from '@/recommender/store-strategy';

describe('resolveChannel', () => {
  it('显式渠道优先', () => {
    expect(resolveChannel({ explicit: 'nearby', hasAddresses: true })).toBe('nearby');
    expect(resolveChannel({ explicit: 'delivery', hasAddresses: false })).toBe('delivery');
  });

  it('有 addressId 直接走麦乐送', () => {
    expect(resolveChannel({ addressId: 'A1', hasAddresses: false })).toBe('delivery');
  });

  it('有地址 → 麦乐送；无地址 → 附近门店', () => {
    expect(resolveChannel({ hasAddresses: true })).toBe('delivery');
    expect(resolveChannel({ hasAddresses: false })).toBe('nearby');
  });
});

describe('channelOrderParams', () => {
  it('麦乐送 orderType=2/beType=2；到店 orderType=1/beType=1', () => {
    expect(channelOrderParams('delivery')).toEqual({ orderType: 2, beType: 2 });
    expect(channelOrderParams('nearby')).toEqual({ orderType: 1, beType: 1 });
  });
});
