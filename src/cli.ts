#!/usr/bin/env node
/**
 * mcd-meal 命令行入口（供各 Agent 的 Skill/命令以 Shell 调用）。
 *
 * 设计：薄封装 `handleRequest`，把 CLI 参数映射为 `SkillRequest`，输出文本或结构化 JSON。
 * 不重写任何业务逻辑；`handleRequest` 已保证「永不抛出」，此处仅处理参数解析错误。
 */

import { pathToFileURL } from 'node:url';

import { isScene, SCENE_VALUES } from './recommender/index.js';

import { handleRequest } from './index.js';

import type { SkillDeps, SkillRequest, SkillResponse } from './index.js';
import type { ProfileClear } from './profile/index.js';

/** 支持的子命令 */
export const CLI_ACTIONS = [
  'recommend',
  'onboarding',
  'configure',
  'reset-profile',
  'set-reminder',
  'show-profile',
  'bind-coupons',
  'chat',
] as const;
export type CliAction = (typeof CLI_ACTIONS)[number];

/** 解析结果 */
export interface ParsedCli {
  action: CliAction;
  request: SkillRequest;
  /** 输出结构化 JSON（否则输出文本） */
  json: boolean;
  /** 仅打印帮助 */
  help: boolean;
}

/** CLI 用法说明 */
export const USAGE = `mcd-meal — 麦当劳套餐推荐助手（命令行）

用法:
  mcd-meal [action] [options]

action（缺省 chat）:
  recommend        生成套餐推荐（1 主推 + ≤2 备选 + 理由 + 券后价）
  onboarding       输出「待问清单」用于冷启动采集（宿主转述）
  configure        把采集答案写入画像（--city/--channel/--budget-*/--taste/--avoid 等）
  reset-profile    重置画像（破坏性，须 --confirmed）
  set-reminder     设定就餐提醒
  show-profile     查看脱敏口味画像
  bind-coupons     领取优惠券（须 --confirmed 才真正执行写操作）
  chat             对话式：先判断提醒是否到点，到点则「提醒 + 推荐」

options:
  --meal-type <lunch|dinner>   餐次
  --city <名称>                附近门店按城市
  --channel <delivery|nearby>  取餐方式（麦乐送 / 到店）
  --store-code <code>          直接指定门店（跳过检索）
  --address-id <id>            麦乐送配送地址
  --budget-min <元> --budget-max <元>   预算区间
  --max-kcal <kcal> --min-protein <g>   营养目标
  --taste <标签,标签>          口味标签（辣/清淡/甜/鸡/牛/鱼）
  --allergy <标签,标签>        过敏原（牛肉/猪肉/鸡肉/海鲜/乳制品/花生坚果/蛋/大豆）
  --avoid <标签,标签>          忌口（同上标签集）
  --clear <维度,维度>          清除画像维度：location/taste/budget/nutrition/dietary
  --scene <scene>              场景：${SCENE_VALUES.join('|')}
  --exclude <code,code>        排除候选（"换一换"）
  --rejected <code>            明确拒绝的套餐（记负反馈并排除）
  --dislike-taste <标签>       口味纠偏（移除该口味并抑制匹配品类）
  --time <HH:mm>               提醒时间
  --days <0,1,2,...>           生效日（0=周日，空=每天）
  --advance-minutes <n>        提前提醒分钟数
  --quiet-start <HH:mm> --quiet-end <HH:mm>   免打扰区间
  --timezone <IANA>            时区（如 Asia/Shanghai）
  --selected <套餐code>        明确选择的套餐（写入强权重画像）
  --accepted                   采纳默认推荐（写入弱权重起始画像）
  --confirmed                  确认执行写操作（领券 / 重置画像）
  --json                       输出完整结构化结果（JSON）
  -h, --help                   显示帮助

环境变量:
  MCD_MCP_TOKEN   麦当劳 MCP 鉴权 Token（缺省则离线降级）
  MCD_OFFLINE      =1 强制离线演示数据（零 MCP 调用）
  LOG_LEVEL        debug|info|warn|error（默认 info）

示例:
  MCD_OFFLINE=1 mcd-meal onboarding                     # 冷启动：获取待问清单
  mcd-meal configure --city 上海 --channel nearby --budget-min 20 --budget-max 40 --taste 辣,鸡
  mcd-meal configure --allergy 乳制品 --avoid 牛肉       # 设置过敏原 / 忌口
  mcd-meal configure --clear taste                       # 清除口味维度
  mcd-meal reset-profile                                 # 请求确认
  mcd-meal reset-profile --confirmed                     # 确认重置画像
  MCD_OFFLINE=1 mcd-meal recommend --meal-type lunch --scene save
  mcd-meal recommend --exclude M001                      # 换一换
  mcd-meal recommend --rejected M003                      # 拒绝某套餐（记负反馈）
  mcd-meal set-reminder --meal-type lunch --time 12:00 --days 1,2,3,4,5 --advance-minutes 10
  mcd-meal bind-coupons            # 先列出可领券并请求确认
  mcd-meal bind-coupons --confirmed
`;

function parseNumber(flag: string, raw: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`参数 ${flag} 需要是数字，收到：${raw}`);
  }
  return value;
}

function parseDays(raw: string): number[] {
  const parts = raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  const days = parts.map((item) => {
    const value = Number(item);
    if (!Number.isInteger(value) || value < 0 || value > 6) {
      throw new Error(`--days 需要 0-6 的整数（逗号分隔），收到：${raw}`);
    }
    return value;
  });
  return days;
}

/** 解析逗号分隔列表（去空白、去空项） */
function parseList(raw: string): string[] {
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * 解析 argv 为结构化调用参数。参数非法时抛出 `Error`（由 `runCli` 捕获并友好提示）。
 */
export function parseArgs(argv: string[]): ParsedCli {
  const request: SkillRequest = {};
  let action: CliAction = 'chat';
  let actionSet = false;
  let json = false;
  let help = false;
  let budgetMin: number | undefined;
  let budgetMax: number | undefined;
  let maxKcal: number | undefined;
  let minProtein: number | undefined;
  let quietStart: string | undefined;
  let quietEnd: string | undefined;

  const valueOf = (index: number, flag: string): string => {
    const value = argv[index + 1];
    if (value === undefined) {
      throw new Error(`参数 ${flag} 缺少取值`);
    }
    return value;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) {
      continue;
    }
    if (!arg.startsWith('-')) {
      if (!actionSet) {
        if (!(CLI_ACTIONS as readonly string[]).includes(arg)) {
          throw new Error(`未知子命令：${arg}`);
        }
        action = arg as CliAction;
        actionSet = true;
        continue;
      }
      throw new Error(`多余的参数：${arg}`);
    }

    switch (arg) {
      case '--help':
      case '-h':
        help = true;
        break;
      case '--json':
        json = true;
        break;
      case '--accepted':
        request.accepted = true;
        break;
      case '--confirmed':
        request.confirmed = true;
        break;
      case '--meal-type': {
        const value = valueOf(i, arg);
        i += 1;
        if (value !== 'lunch' && value !== 'dinner') {
          throw new Error('--meal-type 只能是 lunch 或 dinner');
        }
        request.mealType = value;
        break;
      }
      case '--city':
        request.city = valueOf(i, arg);
        i += 1;
        break;
      case '--address-id':
        request.addressId = valueOf(i, arg);
        i += 1;
        break;
      case '--budget-min':
        budgetMin = parseNumber(arg, valueOf(i, arg));
        i += 1;
        break;
      case '--budget-max':
        budgetMax = parseNumber(arg, valueOf(i, arg));
        i += 1;
        break;
      case '--max-kcal':
        maxKcal = parseNumber(arg, valueOf(i, arg));
        i += 1;
        break;
      case '--min-protein':
        minProtein = parseNumber(arg, valueOf(i, arg));
        i += 1;
        break;
      case '--time':
        request.time = valueOf(i, arg);
        i += 1;
        break;
      case '--days':
        request.days = parseDays(valueOf(i, arg));
        i += 1;
        break;
      case '--advance-minutes':
        request.advanceMinutes = parseNumber(arg, valueOf(i, arg));
        i += 1;
        break;
      case '--quiet-start':
        quietStart = valueOf(i, arg);
        i += 1;
        break;
      case '--quiet-end':
        quietEnd = valueOf(i, arg);
        i += 1;
        break;
      case '--timezone':
        request.timezone = valueOf(i, arg);
        i += 1;
        break;
      case '--channel': {
        const value = valueOf(i, arg);
        i += 1;
        if (value !== 'delivery' && value !== 'nearby') {
          throw new Error('--channel 只能是 delivery 或 nearby');
        }
        request.channel = value;
        break;
      }
      case '--store-code':
        request.storeCode = valueOf(i, arg);
        i += 1;
        break;
      case '--taste':
        request.tasteTags = parseList(valueOf(i, arg));
        i += 1;
        break;
      case '--scene': {
        const value = valueOf(i, arg);
        i += 1;
        if (!isScene(value)) {
          throw new Error(`--scene 只能是 ${SCENE_VALUES.join('/')}`);
        }
        request.scene = value;
        break;
      }
      case '--exclude':
        request.excludeCodes = parseList(valueOf(i, arg));
        i += 1;
        break;
      case '--rejected':
        request.rejectedMealCode = valueOf(i, arg);
        i += 1;
        break;
      case '--dislike-taste':
        request.dislikeTaste = valueOf(i, arg);
        i += 1;
        break;
      case '--allergy':
        request.allergies = parseList(valueOf(i, arg));
        i += 1;
        break;
      case '--avoid':
        request.avoid = parseList(valueOf(i, arg));
        i += 1;
        break;
      case '--clear':
        request.clearFields = parseList(valueOf(i, arg)) as ProfileClear[];
        i += 1;
        break;
      case '--selected':
        request.selectedMealCode = valueOf(i, arg);
        i += 1;
        break;
      default:
        throw new Error(`未知参数：${arg}`);
    }
  }

  if (budgetMin !== undefined || budgetMax !== undefined) {
    request.budget = { min: budgetMin ?? 0, max: budgetMax ?? 999_999 };
  }
  if (maxKcal !== undefined || minProtein !== undefined) {
    request.nutritionGoal = {
      ...(maxKcal !== undefined ? { maxKcal } : {}),
      ...(minProtein !== undefined ? { minProtein } : {}),
    };
  }
  if (quietStart !== undefined || quietEnd !== undefined) {
    if (quietStart === undefined || quietEnd === undefined) {
      throw new Error('--quiet-start 与 --quiet-end 需同时提供');
    }
    request.quietHours = { start: quietStart, end: quietEnd };
  }

  return { action, request, json, help };
}

/** 输出端口（便于测试注入） */
export interface CliIo {
  out: (text: string) => void;
  err: (text: string) => void;
}

const defaultIo: CliIo = {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
};

/**
 * 执行 CLI。返回退出码：0 成功（含业务友好提示）、2 参数错误。
 */
export async function runCli(argv: string[], deps?: SkillDeps, io: CliIo = defaultIo): Promise<number> {
  let parsed: ParsedCli;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.err(`错误：${message}\n\n${USAGE}\n`);
    return 2;
  }

  if (parsed.help) {
    io.out(`${USAGE}\n`);
    return 0;
  }

  const request: SkillRequest = { ...parsed.request };
  request.action = parsed.action === 'chat' ? undefined : parsed.action;

  const response: SkillResponse = await handleRequest(request, deps);
  io.out(parsed.json ? `${JSON.stringify(response, null, 2)}\n` : `${response.text}\n`);
  return 0;
}

const invokedPath = process.argv[1];
const isMain = invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href;
if (isMain) {
  void runCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`错误：${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
