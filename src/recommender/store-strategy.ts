/**
 * 门店/地址策略（技术设计 §4.2 步骤 2）。
 * 有可用配送地址 → 麦乐送（delivery）；否则 → 附近门店（nearby）。
 * `resolveChannel` 为纯函数，便于单测；IO 由调用方（index）完成。
 */

/** 渠道 */
export type Channel = 'delivery' | 'nearby';

/** 渠道判定输入 */
export interface ResolveChannelInput {
  /** 显式渠道（"首次询问并记忆"由 index 负责传入） */
  explicit?: Channel;
  /** 显式指定配送地址 → 直接走麦乐送 */
  addressId?: string;
  /** 是否存在可用配送地址 */
  hasAddresses: boolean;
}

/** 纯函数：解析渠道。`explicit` 优先级最高，其次 `addressId`，再次是否有地址。 */
export function resolveChannel(input: ResolveChannelInput): Channel {
  if (input.explicit) {
    return input.explicit;
  }
  if (input.addressId) {
    return 'delivery';
  }
  return input.hasAddresses ? 'delivery' : 'nearby';
}

/** 渠道对应的下单参数：麦乐送 orderType=2/beType=2；到店 orderType=1/beType=1 */
export function channelOrderParams(channel: Channel): { orderType: 1 | 2; beType: number } {
  return channel === 'delivery' ? { orderType: 2, beType: 2 } : { orderType: 1, beType: 1 };
}
