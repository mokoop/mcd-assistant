import { describe, expect, it } from 'vitest';

import {
  parseAddresses,
  parseBoundCoupons,
  parseCalculatePrice,
  parseMealDetail,
  parseMeals,
  parseNowTimeInfo,
  parseStoreCoupons,
  parseStores,
  readJsonValue,
} from '@/mcp-client/parsers/json';
import { parseCampaigns, parseCoupons, parseMarkdownTables } from '@/mcp-client/parsers/markdown';
import { parseNutritionFoods, parseToon } from '@/mcp-client/parsers/toon';
import type { RawToolResult } from '@/mcp-client/types';

function raw(text: string, structured?: Record<string, unknown>): RawToolResult {
  return structured ? { text, structured } : { text };
}

describe('JSON 解析', () => {
  it('readJsonValue 优先使用 structured，其次解析文本，去除代码围栏', () => {
    expect(readJsonValue(raw('ignored', { a: 1 }))).toEqual({ a: 1 });
    expect(readJsonValue(raw('```json\n{"a":2}\n```'))).toEqual({ a: 2 });
  });

  it('解析门店列表并跳过无 code 项', () => {
    const stores = parseStores(raw('{"stores":[{"storeCode":"S1","storeName":"甲","distance":"120"},{"name":"无码"}]}'));
    expect(stores).toEqual([{ storeCode: 'S1', storeName: '甲', distance: 120 }]);
  });

  it('解析 meals map 结构', () => {
    const result = parseMeals(
      raw('{"meals":{"M001":{"code":"M001","name":"巨无霸套餐","price":39,"category":"汉堡"}}}'),
    );
    expect(result.meals.M001).toEqual({ code: 'M001', name: '巨无霸套餐', price: 39, category: '汉堡' });
  });

  it('解析 now-time-info 并补齐字段', () => {
    const info = parseNowTimeInfo(
      raw('{"datetime":"2026-10-10T12:00:00+08:00","date":"2026-10-10","dayOfWeek":6,"timezone":"Asia/Shanghai","offset":"+08:00"}'),
    );
    expect(info).toEqual({
      datetime: '2026-10-10T12:00:00+08:00',
      date: '2026-10-10',
      dayOfWeek: 6,
      timezone: 'Asia/Shanghai',
      offset: '+08:00',
    });
  });

  it('缺少 datetime 时抛 PARSE_ERROR', () => {
    expect(() => parseNowTimeInfo(raw('{"timezone":"Asia/Shanghai"}'))).toThrowError(/datetime|PARSE/i);
  });

  it('解析价格试算（券后价）', () => {
    expect(parseCalculatePrice(raw('{"originalPrice":39,"discount":8,"price":31}'))).toEqual({
      originalPrice: 39,
      discount: 8,
      price: 31,
    });
  });

  it('解析门店券（JSON）', () => {
    const coupons = parseStoreCoupons(raw('{"coupons":[{"couponId":"C1","couponCode":"X","name":"满减","discount":5}]}'));
    expect(coupons).toEqual([{ couponId: 'C1', couponCode: 'X', name: '满减', discount: '5' }]);
  });

  it('解析可配送地址', () => {
    const addresses = parseAddresses(raw('{"addresses":[{"addressId":"A1","fullAddress":"某地"},{"id":"A2"}]}'));
    expect(addresses).toEqual([
      { addressId: 'A1', fullAddress: '某地' },
      { addressId: 'A2' },
    ]);
  });

  it('解析套餐详情并保留 modification/supportModify', () => {
    const detail = parseMealDetail(
      raw('{"code":"M1","name":"巨无霸套餐","price":"39","supportModify":true,"modification":{"a":1}}'),
    );
    expect(detail).toEqual({
      code: 'M1',
      name: '巨无霸套餐',
      price: 39,
      supportModify: true,
      modification: { a: 1 },
    });
  });

  it('解析 meals 数组形态与 data 包裹形态', () => {
    const arrayForm = parseMeals(raw('{"meals":[{"code":"M1","name":"甲","price":30}]}'));
    expect(arrayForm.meals.M1?.name).toBe('甲');

    const wrapped = parseMeals(raw('{"data":{"meals":{"M2":{"code":"M2","name":"乙"}}}}'));
    expect(wrapped.meals.M2?.name).toBe('乙');
  });

  it('解析领券（写操作）结果', () => {
    const bound = parseBoundCoupons(raw('{"coupons":[{"couponId":"C1","couponCode":"X"},{"id":2}]}'));
    expect(bound).toEqual([{ couponId: 'C1', couponCode: 'X' }, { couponId: '2' }]);
  });

  it('价格试算缺少 price 抛 PARSE_ERROR', () => {
    expect(() => parseCalculatePrice(raw('{"originalPrice":39}'))).toThrowError(/price|PARSE/i);
  });
});

describe('TOON 解析', () => {
  it('解析表格形态（tab 风格 nutrition）', () => {
    const text = [
      'foods[2]{productName,energyKcal,protein,fat,carbohydrate,sodium,calcium}:',
      '  巨无霸套餐,590,27,30,47,1010,180',
      '  麦香鸡套餐,460,20,18,40,850,140',
    ].join('\n');
    const foods = parseNutritionFoods(text);
    expect(foods).toHaveLength(2);
    expect(foods[0]).toEqual({
      productName: '巨无霸套餐',
      nutrition: { energyKcal: 590, protein: 27, fat: 30, carbohydrate: 47, sodium: 1010, calcium: 180 },
    });
  });

  it('解析内联数组与列表形式', () => {
    expect(parseToon('tags[3]: a,b,c')).toEqual({ tags: ['a', 'b', 'c'] });
    expect(parseToon('items[2]:\n  - x\n  - y')).toEqual({ items: ['x', 'y'] });
  });

  it('解析嵌套对象与带引号字符串', () => {
    const text = ['store:', '  code: S1', '  name: "人民, 广场店"'].join('\n');
    expect(parseToon(text)).toEqual({ store: { code: 'S1', name: '人民, 广场店' } });
  });

  it('无法解析为营养记录时返回空数组', () => {
    expect(parseNutritionFoods('与营养无关的文本')).toEqual([]);
  });
});

describe('Markdown 解析', () => {
  it('解析表格券列表', () => {
    const md = ['| 券ID | 名称 | 优惠 | 有效期至 |', '| --- | --- | --- | --- |', '| C901 | 满30减5 | 5 | 2026-12-31 |'].join('\n');
    expect(parseCoupons(md)).toEqual([{ couponId: 'C901', name: '满30减5', discount: '5', validTo: '2026-12-31' }]);
  });

  it('解析活动表格', () => {
    const md = ['| 活动 | 开始 | 结束 |', '| --- | --- | --- |', '| 程序员节 | 2026-10-09 | 2026-10-25 |'].join('\n');
    expect(parseCampaigns(md)).toEqual([{ name: '程序员节', startDate: '2026-10-09', endDate: '2026-10-25' }]);
  });

  it('解析 Markdown 表格结构', () => {
    const tables = parseMarkdownTables(['| a | b |', '| --- | --- |', '| 1 | 2 |'].join('\n'));
    expect(tables).toEqual([{ headers: ['a', 'b'], rows: [['1', '2']] }]);
  });

  it('无结构化内容时券列表返回空', () => {
    expect(parseCoupons('暂无可用优惠券')).toEqual([]);
  });
});
