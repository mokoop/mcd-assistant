---
name: mcd-meal-recommender
description: 麦当劳套餐推荐助手。首次使用先问清位置/预算/口味等必要信息，随后结合口味偏好、预算与营养目标，依据门店可售与可用优惠券给出券后最合适的套餐（1 主推 + ≤2 备选 + 可解释理由）；支持到点就餐提醒、脱敏口味画像、场景模式（省钱/减脂/快速/犒劳/深夜）、饮食禁忌/过敏原过滤、凑单加购建议、画像纠正与重置、反馈纠偏；越用越懂你。当用户说「我中午吃什么」「帮我推荐午餐」「晚上吃啥」「第一次用」「设置就餐提醒」「每天12点提醒我吃饭」「看看我的口味偏好」「帮我领券」「我有忌口/过敏」等时使用。
{{EXTRA_FRONTMATTER}}
---

# 套餐推荐助手（mcd-meal-recommender）

> 本技能**自包含**：可执行 CLI 已随技能打包为 `scripts/mcd-meal.mjs`（单文件，无需克隆仓库或安装依赖）。
> 本文件是规范 Skill 源，由 `scripts/install-skill.mjs` 按目标 Agent 注入 frontmatter 与 CLI 路径后安装。

## 何时使用
当用户表达「吃什么 / 推荐午餐或晚餐 / 到点提醒吃饭 / 查看口味偏好 / 领券」等意图时，使用本技能。

## 前置
- 需要 Node.js ≥ 20。
- 无需 Token 也可演示：命令前加 `MCD_OFFLINE=1` 使用内置离线数据。
- 配置真实数据时，设置环境变量 `MCD_MCP_TOKEN`。

## 工作时，请遵循以下工作流：

CLI 命令（`{{CLI}}`）：

0. **先判断是否需要了解用户（冷启动引导）**
   ```bash
   {{CLI}} onboarding
   ```
   命令会输出一份**待问清单**（每项含"为什么问"，均可跳过）。请用自然语言把清单转述给用户、回收答案，
   再调用 `configure` 落盘（仅传用户实际回答的项）：
   ```bash
   {{CLI}} configure --city 上海 --channel nearby --budget-min 20 --budget-max 40 --taste 辣,鸡
   {{CLI}} configure --allergy 乳制品 --avoid 牛肉    # 过敏原 / 忌口（近似筛选）
   ```
   已有画像时 `onboarding` 会返回"无需再问"，此时直接进入推荐；**用户不想回答也可直接推荐**（冷启动会给出可解释的"热销起点"）。

1. **推荐套餐**
   ```bash
   MCD_OFFLINE=1 {{CLI}} recommend --meal-type lunch
   ```
   可选：`--budget-min 20 --budget-max 40`、`--max-kcal 700 --min-protein 20`、`--city 上海`、`--channel nearby`、`--store-code <code>`、`--address-id <id>`、`--scene save`（场景：auto/quick/save/fit/treat/late）。
   - 用户明确选择了某个套餐时，追加 `--selected <套餐code>` 记录强权重偏好。
   - 用户说"换一个"时，追加 `--exclude <上次主推code>`（换一换，不学习）。
   - 用户明确拒绝某套餐时，追加 `--rejected <套餐code>`（记负反馈并重推）。
   - 用户说"太辣了/不想吃辣"时，追加 `--dislike-taste 辣`（口味纠偏）。
   - 命中满减券且**净省 > 0** 时，输出会附**凑单加购建议**（`Recommendation.bundle`，预计，以官方结算为准）。

2. **画像纠正与重置（v1.2.0）**
   ```bash
   {{CLI}} configure --clear taste,budget          # 清除指定维度
   {{CLI}} reset-profile                           # 先请求确认
   {{CLI}} reset-profile --confirmed               # 确认后重置
   ```

3. **设定就餐提醒**
   ```bash
   {{CLI}} set-reminder --meal-type lunch --time 12:00 --days 1,2,3,4,5 --advance-minutes 10 --quiet-start 22:00 --quiet-end 08:00
   ```

4. **查看口味画像（脱敏）**
   ```bash
   {{CLI}} show-profile
   ```

5. **领券（写操作，须显式确认）**
   ```bash
   {{CLI}} bind-coupons              # 先列出可领券，向用户说明并请求确认
   {{CLI}} bind-coupons --confirmed  # 仅在用户确认后执行
   ```

6. **对话式（先判断提醒是否到点）**：`{{CLI}}`（缺省 action=chat）。

## 输出
文本（提醒文案 + 推荐卡片 + ≥2 条理由 + 券后价 + 可选凑单建议 + 脱敏画像摘要）。需要结构化结果时加 `--json`。

## 安全与合规
- **领券/重置/下单等写操作必须由用户显式确认**（`--confirmed`）；本技能**不调用 `create-order`**，交易边界止于下单引导。
- Token 仅经环境变量 `MCD_MCP_TOKEN` 注入；画像/提醒状态本地脱敏存储、不入库。
- 价格与餐品以麦当劳官方实时结果为准，输出注明"仅供参考"；离线/降级时标注"离线演示数据"。
- **饮食禁忌/过敏原为近似关键词筛选**（非官方成分数据），可能遗漏；**严重过敏请以官方信息或门店确认为准**；凑单为**预计**，以官方结算为准。

## 参考
- `references/usage.md`：CLI 参数与环境变量完整说明。
- `references/mcp.md`：所用 MCP Server 与工具摘要。
