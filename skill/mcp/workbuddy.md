# WorkBuddy 的 MCP 配置（人工步骤）

WorkBuddy 目前通过**界面**配置 MCP，不由文件自动加载。请在 WorkBuddy 中：

1. 打开设置 → MCP / 工具，新增一个 **Streamable HTTP** server：
   - 名称：`mcd-mcp`
   - URL：`https://mcp.mcd.cn`
   - Header：`Authorization: Bearer <你的 MCD_MCP_TOKEN>`
2. 保存并启用；token 建议放在环境变量 `MCD_MCP_TOKEN` 中供客户端引用（若 WorkBuddy 支持环境变量占位）。

> 本仓库的离线模式（`MCD_OFFLINE=1`）不需要 MCP，可先用于演示。
