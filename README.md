# 套餐推荐助手（mcd-meal-recommender）

> **一个到点就叫你吃饭、并且越用越懂你口味与预算的"默认套餐"饭搭子。**

基于麦当劳 MCP（工具标识 `mcd-mcp`，Streamable HTTP）的 TypeScript / Node.js Skill：**首次使用先问清必要信息**（位置/取餐方式、预算、口味、营养目标，可跳过），在设定的就餐时间进行**就餐提醒**，并给出**一个"够好"的默认套餐**（而非一堆选项）；记录用户选择与反馈（含拒绝/口味纠偏），使推荐**越用越准**。


---

## ✨ 差异化亮点

| 亮点 | 说明 |
|------|------|
| **冷启动就可用（不"随便推"）** | 首次即主动问清**最小必要信息**；无画像时以「门店热销 + 券后性价比 + 多样性」给出**可解释的起点推荐**，而非仅按价格排序 |
| **satisficing 默认套餐** | 不甩一堆菜单，直接给 1 个主推 + ≤2 备选；降低"到点不知道吃什么"的决策成本 |
| **偏好画像闭环（含负反馈）** | 选择即画像：明确选择走强权重、采纳走弱权重、**拒绝/换一换/口味纠偏走负反馈**（EMA）；无需手动维护偏好 |
| **场景模式** | `--scene` 一键切换「省钱 / 减脂 / 快速 / 犒劳 / 深夜」，`auto` 按时间自动判定 |
| **券后 + 营养可解释** | 只读券 + `calculate-price` 试算取券后最低价；输出 ≥2 条理由（偏好匹配 / 券后节省 / 营养 / 热销 / 口味），热量标注"仅供参考" |
| **零 Token 可复现** | `MCD_OFFLINE=1` 使用内置演示数据走通「引导 → 提醒 → 推荐 → 画像」全链路，**零 MCP 调用** |

---

## 👤 目标用户

| 用户画像 | 特征 | 诉求 |
|---------|------|------|
| 上班族午餐 | 工作日高频、时间压力大 | 快速、明确的一个建议 |
| 加班党 / 夜宵 | 深夜、决策力耗尽 | 准点提醒 + 直达推荐 |
| 控糖 / 健身 | 每日、需营养核算 | 符合营养约束的套餐 |
| 选择困难星人 | 每次点餐 | 一个可接受的默认值 |
| 学生党 | 高频、价格敏感 | 券后更省 |

---

## 🧩 功能特性

- **🧭 冷启动引导（v1.1.0）**：首次使用 `onboarding` 输出**待问清单**（位置/取餐方式、预算、口味、营养目标，均可跳过），`configure` 落盘；无画像时以「门店热销 + 券后性价比 + 多样性」给出**可解释的默认人格**推荐。
- **🍽️ 就餐提醒（附加）**：设定餐次 + 时间 + 生效日；支持**提前提醒**（`advanceMinutes`）、**免打扰区间**（`quietHours`，区间内顺延）、**时区**与工作日；到点触发一次并去重持久化。Skill 无后台常驻，采用「内置时间判断 + 可选宿主定时建议」，宿主不支持定时时自动降级为对话触发式。
- **🍔 套餐推荐（主要）**：门店 / 地址策略 → 可售候选 → 过滤（可售 / 营养约束）→ 加权打分（偏好 / 预算 / 营养 / 券后性价比 / 多样性 / **口味 / 热销**）→ 券后试算（Top-K）→ 组装 **1 主推 + ≤2 备选 + ≥2 条理由**。
- **🎬 场景模式（v1.1.0）**：`--scene` 切换「省钱 / 减脂 / 快速 / 犒劳 / 深夜」，以权重预设一键改变推荐倾向。
- **📋 偏好画像**：记录明确选择（强权重）、采纳推荐（弱权重）与**拒绝 / 口味纠偏（负反馈）**，按 **EMA** 更新；维度含品类权重、价格带、营养目标、**位置 / 取餐方式、口味标签、饮食禁忌/过敏原**、常点门店 / 时段、最近选择；本地脱敏持久化，并支持 **v1 → v2 平滑迁移**。
- **🛠️ 画像可控（v1.2.0）**：`configure --clear <维度>` 纠错；`reset-profile`（须 `--confirmed`）重置；`show-profile` 透明可查。
- **🥗 饮食禁忌与过敏原（v1.2.0）**：`--allergy`/`--avoid` 设置，推荐时**近似关键词过滤**命中项；无法满足时明确告警（**非医疗建议，严重过敏以官方/门店为准**）。
- **💰 凑单更省（v1.2.0）**：命中满减券门槛且**净省 > 0** 时给出加购建议（`Recommendation.bundle`，预计，以官方结算为准）。
- **🎟️ 领券（写操作）**：仅在用户**显式确认**后调用 `auto-bind-coupons`，不自动执行；交易边界止于下单引导，**不调用 `create-order`**。

---

## 🚀 安装与运行

**环境要求**：Node.js ≥ 20 LTS，包管理器 [pnpm](https://pnpm.io/)。

```bash
pnpm install        # 安装依赖
pnpm lint           # ESLint + Prettier 检查
pnpm typecheck      # tsc --noEmit 类型检查
pnpm test           # Vitest 单元 / 集成测试
pnpm build          # 构建，产物输出至 dist/
```

> 构建产物入口为 `dist/index.js`（类型声明 `dist/index.d.ts`）。

**最小可运行（离线演示，无需 Token）**：

```bash
MCD_OFFLINE=1 node --input-type=module -e "
  import { handleRequest } from './dist/index.js';
  const res = await handleRequest({ action: 'recommend', mealType: 'lunch' });
  console.log(res.text);
"
```

**接入真实数据**：先复制环境变量占位文件并填入 Token，再运行。

```bash
cp .env.example .env      # 填入 MCD_MCP_TOKEN（.env 已被 .gitignore 忽略，禁止入库）
export MCD_MCP_TOKEN=你的Token
pnpm build
```

---

## 🧩 安装到主流 Agent

本仓库提供**可执行 CLI**（`mcd-meal`）与多 Agent 安装器，可把本技能安装到 **CodeBuddy / WorkBuddy / Codex / opencode / Qoder**（GPT 暂不支持）。

```bash
pnpm build
node scripts/install-skill.mjs --agent all --dry-run                    # 先预演
node scripts/install-skill.mjs --agent codebuddy,opencode --scope project
node scripts/install-skill.mjs --agent codex,qoder --scope user
pnpm skill:pack                                                         # 生成 WorkBuddy 上传 zip
```


---

## 💬 使用示例

### 1. 自然语言触发（经 `SKILL.md` 的 `description`）

- 「我中午吃什么」「帮我推荐午餐」「晚上吃啥」→ 触发推荐（对话式缺省：先评估提醒，到点则提醒 + 推荐）
- 「第一次用」「帮我设置一下口味/预算」→ 冷启动引导（输出待问清单 → 回收后落盘）
- 「设置每天 12 点提醒我吃午餐」→ 设定就餐提醒
- 「看看我的口味偏好」→ 展示脱敏画像摘要
- 「帮我领券」→ 列出可领券并请求确认，确认后领取
- 「换一个」「这个不想吃」「太辣了」→ 换一换 / 记负反馈 / 口味纠偏

### 2. 结构化调用（`handleRequest`）

入口为 `handleRequest(request, deps?)`，返回 `SkillResponse`（含 `text` 文本输出与结构化字段），**任何异常都会被捕获为友好中文提示，绝不抛出**。

```ts
import { handleRequest } from 'mcd-meal-recommender';

// action 缺省（'chat'）：先评估提醒，到点则「提醒 + 推荐」
await handleRequest({});

// 冷启动引导：先拿待问清单，回收答案后落盘
await handleRequest({ action: 'onboarding' });
await handleRequest({
  action: 'configure',
  city: '上海',
  channel: 'nearby',
  budget: { min: 20, max: 40 },
  tasteTags: ['辣', '鸡'],
  nutritionGoal: { maxKcal: 700 },
});

// 推荐（可覆盖预算 / 营养目标 / 场景；selectedMealCode 命中则记录强权重选择）
await handleRequest({
  action: 'recommend',
  mealType: 'lunch',
  scene: 'save',                 // auto|quick|save|fit|treat|late
  budget: { min: 20, max: 40 },
  nutritionGoal: { maxKcal: 700, minProtein: 20 },
  selectedMealCode: 'M001',
  accepted: true,                 // 未明确选择时：以主推作为起始画像（弱权重）
});

// 反馈纠偏
await handleRequest({ action: 'recommend', excludeCodes: ['M001'] });       // 换一换
await handleRequest({ action: 'recommend', rejectedMealCode: 'M003' });      // 记负反馈并重推
await handleRequest({ action: 'recommend', dislikeTaste: '辣' });            // 口味纠偏

// 饮食禁忌 / 过敏原（近似筛选）与画像纠正 / 重置
await handleRequest({ action: 'configure', allergies: ['乳制品'], avoid: ['牛肉'] });
await handleRequest({ action: 'configure', clearFields: ['taste'] });        // 清除口味维度
await handleRequest({ action: 'reset-profile' });                            // 请求确认
await handleRequest({ action: 'reset-profile', confirmed: true });           // 确认重置

// 设定提醒
await handleRequest({
  action: 'set-reminder',
  mealType: 'lunch',
  time: '12:00',
  days: [1, 2, 3, 4, 5], // 0=周日 … 6=周六；空=每天
  advanceMinutes: 10,
  quietHours: { start: '22:00', end: '08:00' },
  timezone: 'Asia/Shanghai',
});

// 查看脱敏画像
await handleRequest({ action: 'show-profile' });

// 领券（写操作，两步确认）
await handleRequest({ action: 'bind-coupons' });                      // 先列出，返回确认提示
await handleRequest({ action: 'bind-coupons', confirmed: true });     // 确认后领取
```

`action` 取值：`'recommend' | 'onboarding' | 'configure' | 'reset-profile' | 'set-reminder' | 'show-profile' | 'bind-coupons'`（缺省为 `'chat'`）。

---

## 🔧 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `MCD_MCP_TOKEN` | 是（真实数据） | — | 麦当劳 MCP 鉴权 Token，以 `Authorization: Bearer` 注入；仅经环境变量提供，**禁止硬编码 / 入库** |
| `MCD_OFFLINE` | 否 | — | `=1` 时强制离线演示数据，**零 MCP 调用**（无 Token 也可跑通全链路） |
| `LOG_LEVEL` | 否 | `info` | 日志级别：`debug` / `info` / `warn` / `error`；日志对 Token / 手机号 / 地址等敏感字段自动脱敏 |
| `MCD_DATA_DIR` | 否 | `<技能/仓库根>/data` | 本地数据目录（画像/提醒）；默认锚定 **CLI 所在技能/仓库根目录**（技能即 `<skillDir>/data`，codex/opencode 即 `<agentDir>/mcd-meal/data`），v1.3.0 |
| `MCD_PROFILE_PATH` | 否 | `<数据目录>/profile.json` | 偏好画像持久化文件路径（覆盖 `MCD_DATA_DIR`） |
| `MCD_PROFILE_ALPHA_STRONG` | 否 | `0.4` | 明确选择的 EMA 系数（取值 `(0,1]`，非法值回退默认） |
| `MCD_PROFILE_ALPHA_WEAK` | 否 | `0.15` | 未明确选择 / 采纳推荐的 EMA 系数（取值 `(0,1]`） |
| `MCD_PROFILE_HISTORY_LIMIT` | 否 | `50` | 画像保留的最近选择条数上限（正整数） |
| `MCD_PROFILE_NEGATIVE_BETA` | 否 | `0.3` | 负反馈 EMA 系数（拒绝/口味纠偏时对命中品类的衰减比例，取值 `(0,1)`） |
| `MCD_REMINDER_CONFIG_PATH` | 否 | `<数据目录>/reminder-config.json` | 提醒配置持久化路径 |
| `MCD_REMINDER_STATE_PATH` | 否 | `<数据目录>/reminder-state.json` | 提醒去重状态持久化路径 |

> v1.3.0 起，画像/提醒数据默认写入 **CLI 所在技能/仓库根目录下的 `data/`**（打包技能即 `<skillDir>/data`；codex/opencode 即 `<agentDir>/mcd-meal/data`），不再依赖宿主当前工作目录；其他入口（库 import / `node_modules/.bin` shim / 目录入口）回退当前目录。可用 `MCD_DATA_DIR` 指定统一数据目录（相对值会归一化为绝对路径）。

> `data/` 目录已被 `.gitignore` 忽略，含偏好 / 提醒状态的数据不入库。
> 推荐权重、Top-K、缓存 TTL、超时、并发上限等集中配置于 `src/recommender/config.ts`（单一调参面，按需在代码中调整）。

---

## 📁 目录结构

```text
src/                     # Skill 源码（TypeScript）
├── mcp-client/          # mcd-mcp 接入层：鉴权、限流退避、按格式解析、缓存、离线降级
├── recommender/         # 套餐推荐：候选生成、过滤、打分、券后试算、可解释组装
├── profile/             # 用户偏好画像：EMA 更新、原子持久化、脱敏摘要
├── reminder/            # 就餐提醒：到点判断、去重状态、宿主定时建议
├── types/               # 公共类型
├── core/                # 统一错误（AppError）与日志（脱敏）
├── output.ts            # 文本呈现层（纯函数）
└── index.ts             # Skill 入口与端到端编排
tests/                   # Vitest 单元 / 集成测试
skill/                   # 规范 Skill 源（SKILL.md + references + 各 Agent MCP 模板）
scripts/                 # 多 Agent 安装器（install-skill.mjs）
docs/                    # 需求（00_PRD）与设计（01_DESIGN）文档
README.md                # 本文件
MCP_INTEGRATION.md       # MCP 集成说明（工具 / 调用流程 / 业务价值）
SKILL.md                 # Skill 元数据与触发描述（CodeBuddy 风格）
AGENTS.md                # Agent 协作与规范执行入口
CONTEST_DECLARATION.md   # 参赛声明（不可改动）
```

**技术栈**：TypeScript（`strict`）· ESM · Node ≥ 20 · pnpm · zod · MCP SDK（Streamable HTTP）· Vitest · ESLint + Prettier。


