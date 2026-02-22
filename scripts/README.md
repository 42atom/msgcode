# scripts 目录说明

## 目录职责

1. 放置运行时冒烟、门禁统计、辅助验证脚本。
2. 脚本默认不改业务状态；需要写入时必须显式输出路径。

## 主要脚本

- `smoke-20-case.ts`：Tool Loop 20-case 健康检查模板。
- `slo-stats.ts`：SLO 连续流量统计脚本。
- `r9-real-smoke.ts`：P5.7-R9 真实能力验收模板生成器（8 项场景 + 3 重点指标）。
- `toolloop-smoke.ts`：LM Studio Tool Loop 联调脚本。
- `mcp-smoke.ts`：LM Studio MCP 原生接口冒烟脚本。

## 使用约定

1. 脚本入口保持可直接运行：`npx tsx scripts/<file>.ts`。
2. 输出统一落到 `AIDOCS/reports/`，便于留痕与复盘。
3. 新增脚本时，必须同步更新本文件。
