/**
 * Markdown 结构化抽取（技术设计 §3.2：`available-coupons` / `query-my-coupons` / `campaign-calendar`）。
 * 解析失败/无匹配由调用方按「视为空结果并告警」处理。采用容错策略：
 * 优先解析表格（`| a | b |`），其次解析列表项（`- key: value` / `- 名称（key）`）。
 */

import type { CampaignInfo, CouponInfo } from '../../types/index.js';

/** 一张 Markdown 表格 */
export interface MarkdownTable {
  headers: string[];
  rows: string[][];
}

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

/** 抽取所有 Markdown 表格 */
export function parseMarkdownTables(markdown: string): MarkdownTable[] {
  const lines = markdown.split(/\r?\n/);
  const tables: MarkdownTable[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const next = lines[i + 1];
    const isHeader = line.includes('|');
    const isSeparator = Boolean(next && /^\s*\|?[\s:|-]+\|?\s*$/.test(next) && next.includes('-'));
    if (isHeader && isSeparator) {
      const headers = splitRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes('|')) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      tables.push({ headers, rows });
      continue;
    }
    i += 1;
  }
  return tables;
}

const COUPON_ID_KEYS = ['couponid', 'id', '券id', '券编号'];
const COUPON_CODE_KEYS = ['couponcode', 'code', '券码', '券代码'];
const COUPON_NAME_KEYS = ['name', 'title', 'couponname', '名称', '券名', '券名称'];
const COUPON_DISCOUNT_KEYS = ['discount', 'amount', 'value', '面额', '优惠'];
const VALID_FROM_KEYS = ['validfrom', 'startdate', 'start', '有效期起', '生效'];
const VALID_TO_KEYS = ['validto', 'enddate', 'end', 'expire', '有效期至', '截止'];

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[\s_*`]/g, '');
}

function findColumn(headers: string[], aliases: string[]): number {
  const normalized = headers.map((header) => normalizeHeader(header));
  return normalized.findIndex((header) => aliases.includes(header));
}

function couponFromCells(headers: string[], cells: string[]): CouponInfo | undefined {
  const couponId = findColumn(headers, COUPON_ID_KEYS);
  const couponCode = findColumn(headers, COUPON_CODE_KEYS);
  const name = findColumn(headers, COUPON_NAME_KEYS);
  const discount = findColumn(headers, COUPON_DISCOUNT_KEYS);
  const validFrom = findColumn(headers, VALID_FROM_KEYS);
  const validTo = findColumn(headers, VALID_TO_KEYS);

  const pick = (index: number): string | undefined => {
    const value = index >= 0 ? cells[index]?.trim() : undefined;
    return value && value.length > 0 ? value : undefined;
  };

  const coupon: CouponInfo = {};
  const id = pick(couponId);
  const code = pick(couponCode);
  const couponName = pick(name);
  const couponDiscount = pick(discount);
  const from = pick(validFrom);
  const to = pick(validTo);
  if (id) coupon.couponId = id;
  if (code) coupon.couponCode = code;
  if (couponName) coupon.name = couponName;
  if (couponDiscount) coupon.discount = couponDiscount;
  if (from) coupon.validFrom = from;
  if (to) coupon.validTo = to;

  return Object.keys(coupon).length > 0 ? coupon : undefined;
}

/** 从 Markdown 抽取券列表（表格优先；无表格时回退列表项 key: value） */
export function parseCoupons(markdown: string): CouponInfo[] {
  const coupons: CouponInfo[] = [];
  for (const table of parseMarkdownTables(markdown)) {
    for (const row of table.rows) {
      const coupon = couponFromCells(table.headers, row);
      if (coupon) {
        coupons.push(coupon);
      }
    }
  }
  if (coupons.length > 0) {
    return coupons;
  }
  // 回退：`- key: value` 列表项聚合为一条券
  const current: Record<string, string> = {};
  const flush = (): void => {
    if (Object.keys(current).length === 0) {
      return;
    }
    const coupon: CouponInfo = {};
    if (current.couponid) coupon.couponId = current.couponid;
    if (current.couponcode) coupon.couponCode = current.couponcode;
    if (current.name) coupon.name = current.name;
    if (current.discount) coupon.discount = current.discount;
    coupons.push(coupon);
    for (const key of Object.keys(current)) {
      delete current[key];
    }
  };
  for (const line of markdown.split(/\r?\n/)) {
    const item = /^\s*[-*]\s+(.+)$/.exec(line);
    if (!item) {
      continue;
    }
    const kv = /^([^:：]+)[:：]\s*(.+)$/.exec(item[1]);
    if (!kv) {
      continue;
    }
    const key = normalizeHeader(kv[1]);
    if (COUPON_NAME_KEYS.includes(key) || COUPON_ID_KEYS.includes(key)) {
      flush();
    }
    current[key] = kv[2].trim();
  }
  flush();
  return coupons;
}

/** 从 Markdown 抽取活动列表（表格优先；回退标题/列表） */
export function parseCampaigns(markdown: string): CampaignInfo[] {
  const campaigns: CampaignInfo[] = [];
  for (const table of parseMarkdownTables(markdown)) {
    const nameCol = findColumn(table.headers, ['name', 'title', '活动', '名称']);
    const startCol = findColumn(table.headers, ['startdate', 'start', '开始', '开始日期']);
    const endCol = findColumn(table.headers, ['enddate', 'end', '结束', '结束日期']);
    const descCol = findColumn(table.headers, ['description', 'desc', '说明', '描述']);
    for (const row of table.rows) {
      const name = nameCol >= 0 ? row[nameCol]?.trim() : undefined;
      if (!name) {
        continue;
      }
      const campaign: CampaignInfo = { name };
      if (startCol >= 0 && row[startCol]?.trim()) campaign.startDate = row[startCol].trim();
      if (endCol >= 0 && row[endCol]?.trim()) campaign.endDate = row[endCol].trim();
      if (descCol >= 0 && row[descCol]?.trim()) campaign.description = row[descCol].trim();
      campaigns.push(campaign);
    }
  }
  if (campaigns.length > 0) {
    return campaigns;
  }
  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^#{1,6}\s+(.+)$/.exec(line);
    if (heading) {
      campaigns.push({ name: heading[1].trim() });
    }
  }
  return campaigns;
}
