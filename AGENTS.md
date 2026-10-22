# AGENTS.md

> 本文件是本项目的 **Agent 协作与规范执行入口**。
> 所有 AI Agent 与研发人员在本仓库内进行任何需求、设计、编码、测试、文档操作前，**必须先阅读并严格遵守** `docs/dev_spec.md`（开发流程、文档管理、评审规程的唯一权威）。

---

## 1. 项目速览

- **mcd-meal-recommender**：基于麦当劳 MCP（工具标识 `mcd-mcp`，Streamable HTTP，`https://mcp.mcd.cn`，`.mcp.json` 已配置）的**套餐推荐助手 Skill**——就餐提醒（附加）+ 套餐推荐（主要）+ 偏好画像闭环。
- **技术栈**：TypeScript `strict` · ESM（NodeNext）· Node ≥ 20 · pnpm · zod · Vitest · ESLint 9 flat config + Prettier。
- **无独立 Web 前端**：用户界面即 Skill 的对话交互与文本输出（呈现层在 `src/output.ts`，纯函数）。
- **入口**：`src/index.ts` 暴露 `handleRequest(request, deps?)`（唯一编排入口）；CLI 为 `src/cli.ts`（bin `mcd-meal`，产物 `dist/cli.js`）。`handleRequest` 的任何异常都被捕获为友好中文提示，**绝不抛出**。

---

## 2. 常用命令

```bash
pnpm install                                  # 安装依赖
pnpm lint                                     # ESLint（已含 prettier 校验）
pnpm typecheck                                # tsc --noEmit（含 tests）
pnpm test                                     # Vitest 全量（tests/**/*.test.ts）
pnpm test tests/recommender/score.test.ts     # 只跑单个测试文件
pnpm test:coverage                            # 覆盖率（v8，报告含 text + html）
pnpm build                                    # tsc 构建到 dist/ + node scripts/build-skill.mjs
pnpm format                                   # prettier --write .
```

- 测试完全离线可跑：MCP 调用层有离线降级与 fake 依赖（`tests/recommender/fake-deps.ts`），无需 Token / 网络。
- 端到端离线验证全链路：`MCD_OFFLINE=1`（零 MCP 调用，无需 Token）。
- Skill 多 Agent 安装器：`node scripts/install-skill.mjs --agent <name> [--scope project|user] [--dry-run]`；打包 `pnpm skill:pack`。

---

## 3. 架构约定与关键机制（不看代码易踩坑）

- **MCP 访问唯一通道**：所有 `mcd-mcp` 调用必须经 `src/mcp-client` 适配层（鉴权、限流退避、按格式解析、缓存、离线降级）；**业务层禁止越过适配层直连**（dev_spec §1.4）。
- **写操作边界**：仅 `bind-coupons`（领券）是写操作，必须**两步显式确认**（先列券 → 用户确认后 `confirmed: true`）；**严禁调用 `create-order`**，交易止于下单引导。
- **调参单一入口**：推荐权重、Top-K、缓存 TTL、超时、并发上限等集中在 `src/recommender/config.ts`；画像 EMA 系数默认值在 `src/profile/defaults.ts`。
- **运行时数据目录**：画像 / 提醒状态默认写仓库根 `data/`（已被 `.gitignore` 忽略，**数据不入库**）；可用 `MCD_DATA_DIR` / `MCD_PROFILE_PATH` / `MCD_REMINDER_*_PATH` 覆盖。
- **路径别名**：`@/` → `src/`（tsconfig paths + vitest resolve 同时配置，两者要保持一致）。
- **公共类型与 schema**：zod schema 与类型集中管理；画像支持 v1 → v2 平滑迁移（`src/profile/store.ts`）。

---

## 4. 代码风格（ESLint 强制，评审会拦截）

- 禁止 `any`（需要时用 `unknown` + 类型收窄）；导出的公共 API 须显式标注返回类型。
- 除 Skill 输出层外**禁止 `console.*`**，日志统一走 `src/core/logger`（自动脱敏 Token/手机号/地址）；错误统一走 `src/core` 的 `AppError` 层级。
- 禁止空 `catch {}` 吞异常。
- `import/order` 强制：内置 → 第三方 → 内部（`@/`），组间空行、字母序。
- Prettier 经 `eslint-config-prettier` 集成进 `pnpm lint`，格式冲突以 `.prettierrc` 为准。

---

## 5. 目录结构

```
📁 src/                     # Skill 源码（TypeScript）
├── index.ts                # 入口与端到端编排（handleRequest）
├── cli.ts                  # CLI 入口（dist/cli.js）
├── output.ts               # 文本呈现层（纯函数）
├── core/                   # AppError 统一错误 + 脱敏 logger
├── mcp-client/             # mcd-mcp 接入层（所有 MCP 调用的唯一通道）
├── recommender/            # 套餐推荐：候选/过滤/打分/券后试算/组装
├── profile/                # 偏好画像：EMA 更新、原子持久化、脱敏摘要、迁移
├── reminder/               # 就餐提醒：到点判断、去重状态
└── types/                  # 公共类型
📁 tests/                   # 单元 + 集成测试（Vitest，全离线）
📁 skill/                   # 规范 Skill 源（SKILL.md + references + 各 Agent MCP 模板）
📁 scripts/                 # build-skill.mjs / install-skill.mjs（多 Agent 安装器）
📁 data/                    # 运行时数据（gitignore 忽略）
📁 docs/                    # dev_spec.md / 00_PRD / 01_DESIGN / 02_OTHERS
📄 SKILL.md                 # 根级 Skill 元数据（触发描述）
📄 README.md / MCP_INTEGRATION.md / CONTEST_DECLARATION.md / AGENTS.md
```

---

