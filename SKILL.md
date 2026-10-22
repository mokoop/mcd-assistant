---
name: mcd-meal-recommender
description: 麦当劳套餐推荐助手。首次使用先问清位置/预算/口味等必要信息，结合口味偏好、预算与营养目标，依据门店可售与可用优惠券推荐券后最合适的套餐；支持到点就餐提醒、脱敏口味画像、场景模式（省钱/减脂/快速/犒劳/深夜）、饮食禁忌/过敏原过滤、凑单加购建议、画像纠正与重置，以及反馈纠偏。当用户说「我中午吃什么」「帮我推荐午餐」「晚上吃啥」「第一次用」「设置就餐提醒」「每天12点提醒我吃饭」「看看我的口味偏好」「帮我领券」「我有忌口/过敏」等时使用。
allowed-tools: Bash(node:*), mcp__mcd-mcp
---

# 套餐推荐助手（mcd-meal-recommender）


基于麦当劳 MCP（`mcd-mcp`，Streamable HTTP）的套餐推荐 Skill：**到点就餐提醒 + 券后套餐推荐 + 偏好画像**。

## 能力

- **冷启动引导**：首次使用输出「待问清单」（位置/取餐方式、预算、口味、营养目标，均可跳过），回收后落盘画像。
- **冷启动默认人格**：无画像时以「门店热销 + 券后性价比 + 多样性」给出可解释的起点推荐（非随机），并提示"越用越懂你"。
- **到点提醒**：配置就餐时间（含提前量、免打扰、时区、生效日），到点提醒并顺手推荐。
- **套餐推荐**：门店/地址策略 → 可售候选 → 过滤（可售/营养约束）→ 打分（偏好/价格/营养/券后性价比/多样性/口味/热销）→ 券后试算 → 主推 + ≤2 备选 + ≥2 条可解释理由。
- **偏好画像**：记录明确选择（强）、采纳推荐（弱）、**拒绝/口味纠偏（负）**，EMA 更新；`location`/`taste`/`dietary` 维度。
- **画像可控（v1.2.0）**：`configure --clear` 清除单个维度；`reset-profile`（须 `--confirmed`）整体重置。
- **饮食禁忌与过敏原（v1.2.0）**：`--allergy`/`--avoid` 设置，推荐时**近似关键词过滤**命中项；无法满足时明确告警（非医疗建议）。
- **凑单更省（v1.2.0）**：命中满减券门槛且**净省 > 0** 时给出加购建议（预计，以官方结算为准）。
- **场景模式**：`--scene` 一键切换（省钱/减脂/快速/犒劳/深夜），`auto` 按时间自动判定。
- **反馈纠偏**：`--exclude`（换一换）、`--rejected`（拒绝）、`--dislike-taste`（口味纠偏）。
- **领券（写操作）**：仅在用户**显式确认**后调用 `auto-bind-coupons`，不自动执行。

## 触发方式

- 对话式（自然语言）：如「我中午吃什么」「帮我推荐午餐」「晚上吃啥」「第一次用」「设置每天 12 点提醒我吃午餐」。
- 命令式（可选）：`/mcd-meal`。

## 执行方式（CLI）

在仓库根目录构建后，用 Shell 调用 CLI，并把输出呈现给用户：

```bash
pnpm build
# 冷启动：先问清楚
node dist/cli.js onboarding
node dist/cli.js configure --city 上海 --channel nearby --budget-min 20 --budget-max 40 --taste 辣,鸡
# 推荐（可带场景/换一换/纠偏；命中满减券会给出凑单建议）
MCD_OFFLINE=1 node dist/cli.js recommend --meal-type lunch --scene save
node dist/cli.js configure --allergy 乳制品 --avoid 牛肉   # 过敏原/忌口（近似筛选）
node dist/cli.js configure --clear taste                   # 清除口味维度
node dist/cli.js reset-profile --confirmed                 # 重置画像（破坏性，须确认）
node dist/cli.js recommend --exclude M001
node dist/cli.js set-reminder --meal-type lunch --time 12:00 --days 1,2,3,4,5 --advance-minutes 10
node dist/cli.js show-profile
node dist/cli.js bind-coupons            # 先列券并请求确认
node dist/cli.js bind-coupons --confirmed
```


## 输入参数

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `mealType` | `'lunch' \| 'dinner'` | 餐次 |
| `time` | `'HH:mm'` | 提醒时间 |
| `city` / `channel` / `storeCode` / `addressId` | string | 位置与取餐方式（附近门店 / 到店 / 指定门店 / 麦乐送地址） |
| `budget` | `{min,max}` | 预算（覆盖画像价格带） |
| `nutritionGoal` | `{maxKcal?,minProtein?}` | 营养目标 |
| `tasteTags` | string[] | 口味标签（configure 落盘） |
| `allergies` / `avoid` | string[] | 过敏原 / 忌口标签（配置落盘；推荐时按近似关键词过滤） |
| `clearFields` | `ProfileClear[]` | configure 清除维度：`location`/`taste`/`budget`/`nutrition`/`dietary` |
| `scene` | `Scene` | 场景：`auto`/`quick`/`save`/`fit`/`treat`/`late` |
| `excludeCodes` | string[] | 排除候选（换一换） |
| `rejectedMealCode` | string | 明确拒绝的套餐（负反馈） |
| `dislikeTaste` | string | 口味纠偏标签 |
| `confirmed` | boolean | 写操作确认（领券 / 重置画像） |
| `action` | `'recommend' \| 'onboarding' \| 'configure' \| 'reset-profile' \| 'set-reminder' \| 'show-profile' \| 'bind-coupons'` | 动作（缺省为对话式：先评估提醒，到点则提醒 + 推荐） |

## 输出

文本（提醒文案 + 推荐卡片 + ≥2 条理由 + 券后价 + 可选脱敏画像摘要，冷启动/场景会额外注明）+ 结构化 `Recommendation`（供宿主/调试）+ 脱敏画像摘要；`onboarding` 输出结构化待问清单。

## 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `MCD_MCP_TOKEN` | 是 | 麦当劳 MCP 鉴权 Token（仅经环境变量注入，禁止入库） |
| `MCD_OFFLINE` | 否 | `=1` 强制离线演示数据，**零 MCP 调用** |

## 安全与合规

- Token 仅经环境变量注入；日志对手机号/地址/Token 脱敏；
- 领券/下单等写操作须用户显式确认；**不使用 `create-order`**（交易边界止于下单引导）；
- 价格与餐品以官方实时结果为准，输出注明"仅供参考"；离线/降级时标注"离线演示数据"。
- **饮食禁忌/过敏原为近似关键词筛选**，非官方成分数据、可能遗漏；**严重过敏请以官方信息或门店确认为准**；凑单为**预计**，以官方结算为准。

