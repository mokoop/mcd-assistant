/**
 * TOON（Token-Oriented Object Notation）解析器。
 *
 * 技术设计 §3.2：`list-nutrition-foods` 返回 TOON 文本，需专用解析器解析后按 `productName` 匹配。
 * 覆盖 TOON 的四种形态：标量/对象、内联数组、列表（`- `）、表格（`key[N]{f1,f2}:` + 行）。
 * 解析失败由调用方按「视为空结果并告警」处理（§3.2）。
 */

import type { NutritionInfo, NutritionFood } from '../../types/index.js';

interface Line {
  indent: number;
  text: string;
}

/** 去除 ```toon / ``` 代码围栏并规整缩进（tab → 2 空格） */
function normalizeLines(input: string): Line[] {
  const withoutFence = input
    .replace(/^\s*```[a-zA-Z]*\s*\n/, '')
    .replace(/\n```\s*$/, '')
    .replace(/```/g, '');
  const lines: Line[] = [];
  for (const raw of withoutFence.split(/\r?\n/)) {
    const expanded = raw.replace(/\t/g, '  ');
    if (expanded.trim().length === 0) {
      continue;
    }
    const indent = expanded.length - expanded.trimStart().length;
    lines.push({ indent, text: expanded.trim() });
  }
  return lines;
}

/** 按逗号切分，忽略引号内与括号内的逗号 */
function splitInline(text: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let inQuote = false;
  for (const ch of text) {
    if (ch === '"') {
      inQuote = !inQuote;
    } else if (!inQuote) {
      if (ch === '[' || ch === '{') {
        depth += 1;
      } else if (ch === ']' || ch === '}') {
        depth -= 1;
      }
    }
    if (ch === ',' && depth === 0 && !inQuote) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

/** 解析单个标量 token */
export function parseToonScalar(token: string): unknown {
  const value = token.trim();
  if (value.length === 0) {
    return '';
  }
  if (value === 'null' || value === '~') {
    return null;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  const quoted = /^"(.*)"$/s.exec(value);
  if (quoted) {
    return quoted[1].replace(/\\"/g, '"').replace(/\\n/g, '\n');
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  return value;
}

function parseScalarOrInline(rest: string): unknown {
  const value = rest.trim();
  if (value.startsWith('[') && value.endsWith(']')) {
    return splitInline(value.slice(1, -1)).map((part) => parseToonScalar(part));
  }
  if (value.startsWith('{') && value.endsWith('}')) {
    const obj: Record<string, unknown> = {};
    for (const pair of splitInline(value.slice(1, -1))) {
      const idx = pair.indexOf(':');
      if (idx >= 0) {
        obj[pair.slice(0, idx).trim()] = parseToonScalar(pair.slice(idx + 1));
      }
    }
    return obj;
  }
  return parseToonScalar(value);
}

const ARRAY_HEADER = /^(.+?)\[(\d+)\]\s*(?:\{([^}]*)\})?\s*:\s?(.*)$/s;
const KEY_VALUE = /^([^:]+):\s?(.*)$/s;

function parseList(lines: Line[], start: number, indent: number): { value: unknown[]; next: number } {
  const items: unknown[] = [];
  let i = start;
  while (i < lines.length && lines[i].indent === indent && lines[i].text.startsWith('-')) {
    const rest = lines[i].text.replace(/^-\s?/, '');
    if (rest.trim().length === 0) {
      i += 1;
      if (i < lines.length && lines[i].indent > indent) {
        const child = parseBlock(lines, i, lines[i].indent);
        items.push(child.value);
        i = child.next;
      } else {
        items.push(null);
      }
    } else if (KEY_VALUE.test(rest)) {
      // `- key: value` 形式的对象项：构造虚拟块复用对象解析
      const virtual: Line[] = [{ indent: indent + 2, text: rest }];
      i += 1;
      while (i < lines.length && lines[i].indent > indent) {
        virtual.push(lines[i]);
        i += 1;
      }
      items.push(parseBlock(virtual, 0, indent + 2).value);
    } else {
      items.push(parseScalarOrInline(rest));
      i += 1;
    }
  }
  return { value: items, next: i };
}

function parseObject(lines: Line[], start: number, indent: number): { value: Record<string, unknown>; next: number } {
  const obj: Record<string, unknown> = {};
  let i = start;
  while (i < lines.length && lines[i].indent === indent && !lines[i].text.startsWith('-')) {
    const line = lines[i];
    const arrayMatch = ARRAY_HEADER.exec(line.text);
    if (arrayMatch) {
      const key = arrayMatch[1].trim();
      const fieldsStr = arrayMatch[3];
      const inlineRest = arrayMatch[4] ?? '';
      if (fieldsStr !== undefined) {
        const fields = fieldsStr
          .split(',')
          .map((field) => field.trim())
          .filter((field) => field.length > 0);
        i += 1;
        const rows: Record<string, unknown>[] = [];
        while (i < lines.length && lines[i].indent > indent) {
          const cells = splitInline(lines[i].text);
          const row: Record<string, unknown> = {};
          fields.forEach((field, col) => {
            row[field] = parseToonScalar(cells[col] ?? '');
          });
          rows.push(row);
          i += 1;
        }
        obj[key] = rows;
      } else if (inlineRest.trim().length > 0) {
        obj[key] = splitInline(inlineRest).map((part) => parseToonScalar(part));
        i += 1;
      } else {
        i += 1;
        if (i < lines.length && lines[i].indent > indent) {
          const child = parseBlock(lines, i, lines[i].indent);
          obj[key] = child.value;
          i = child.next;
        } else {
          obj[key] = [];
        }
      }
      continue;
    }

    const kv = KEY_VALUE.exec(line.text);
    if (kv) {
      const key = kv[1].trim();
      const rest = kv[2];
      if (rest.trim().length > 0) {
        obj[key] = parseScalarOrInline(rest);
        i += 1;
      } else {
        i += 1;
        if (i < lines.length && lines[i].indent > indent) {
          const child = parseBlock(lines, i, lines[i].indent);
          obj[key] = child.value;
          i = child.next;
        } else {
          obj[key] = null;
        }
      }
      continue;
    }

    i += 1;
  }
  return { value: obj, next: i };
}

function parseBlock(lines: Line[], start: number, indent: number): { value: unknown; next: number } {
  if (start < lines.length && lines[start].text.startsWith('-')) {
    return parseList(lines, start, indent);
  }
  return parseObject(lines, start, indent);
}

/** 解析 TOON 文本为 JSON 数据模型（对象/数组/标量） */
export function parseToon(text: string): unknown {
  const lines = normalizeLines(text);
  if (lines.length === 0) {
    return null;
  }
  return parseBlock(lines, 0, lines[0].indent).value;
}

const NUTRIENT_KEYS: Array<[keyof NutritionInfo, string[]]> = [
  ['energyKcal', ['energyKcal', 'energy', 'kcal', 'calorie', 'calories', '热量']],
  ['protein', ['protein', '蛋白质']],
  ['fat', ['fat', '脂肪']],
  ['carbohydrate', ['carbohydrate', 'carbs', '碳水', '碳水化合物']],
  ['sodium', ['sodium', '钠']],
  ['calcium', ['calcium', '钙']],
];

const NAME_KEYS = ['productName', 'name', 'foodName', 'mealName', 'product', '餐品', '名称'];

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function pickKey(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in record) {
      return record[key];
    }
  }
  return undefined;
}

function collectRecords(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null);
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    for (const candidate of ['foods', 'list', 'data', 'items', 'nutrition', 'result', 'rows']) {
      const nested = record[candidate];
      if (Array.isArray(nested)) {
        return nested.filter(
          (item): item is Record<string, unknown> => typeof item === 'object' && item !== null,
        );
      }
    }
  }
  return [];
}

/** 将 TOON 文本解析为营养记录数组（按 productName 与候选匹配；无有效记录返回 []） */
export function parseNutritionFoods(text: string): NutritionFood[] {
  const records = collectRecords(parseToon(text));
  const foods: NutritionFood[] = [];
  for (const record of records) {
    const name = pickKey(record, NAME_KEYS);
    if (typeof name !== 'string' || name.trim().length === 0) {
      continue;
    }
    const nutrition: NutritionInfo = {};
    for (const [field, aliases] of NUTRIENT_KEYS) {
      const numeric = toNumber(pickKey(record, aliases));
      if (numeric !== undefined) {
        nutrition[field] = numeric;
      }
    }
    foods.push({ productName: name.trim(), nutrition });
  }
  return foods;
}
