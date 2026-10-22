# MCP 集成摘要

> 规范化 Skill 源的一部分。完整说明见仓库根 `MCP_INTEGRATION.md`。

- **MCP Server**：`mcd-mcp`（麦当劳），传输 **Streamable HTTP**，端点 `https://mcp.mcd.cn`。
- **鉴权**：`Authorization: Bearer ${MCD_MCP_TOKEN}`（仅经环境变量注入，禁止入库）。
- **客户端**：本仓库 `src/mcp-client/` 使用 `@modelcontextprotocol/sdk`。

## 使用的工具（只读为主）

| Tool | 用途 | 返回格式 |
|------|------|---------|
| `now-time-info` | 到点判断 | JSON |
| `query-nearby-stores` | 附近门店（到店） | JSON |
| `delivery-query-addresses` / `delivery-query-stores` | 麦乐送地址与门店 | JSON |
| `query-meals` | 门店可售餐品 | JSON |
| `query-meal-detail` | 套餐组成（仅读取） | JSON |
| `list-nutrition-foods` | 营养信息 | TOON |
| `available-coupons` / `query-store-coupons` / `query-my-coupons` | 只读券 | Markdown / JSON |
| `calculate-price` | 券后价试算 | JSON |
| `campaign-calendar` | 活动日历（已封装·预留） | Markdown |
| `auto-bind-coupons` | 一键领券（**写操作**，须用户显式确认） | JSON |

## 边界
- **不使用 `create-order` / `cancel-order`**，交易止于下单引导。
- MCP 异常（401/429/超时/解析失败）均降级、不崩溃；`MCD_OFFLINE=1` 时零 MCP 调用。
