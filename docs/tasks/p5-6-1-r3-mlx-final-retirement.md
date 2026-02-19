# P5.6.1-R3：MLX Final Retirement（一次性清零）

## 背景

MLX 曾执行过退役，但代码已回流：`handlers`/`providers`/`runners`/`workspace config`/测试仍有完整链路。  
本任务目标是彻底移除 MLX 运行时能力，避免双供应商分裂与维护成本回升。

## 目标

1. 运行时不再存在 `mlx` 执行分支。
2. 配置与命令面不再暴露 `mlx`。
3. 测试与文档口径统一为 `lmstudio`（或保留兼容别名但内部归一化，不保留独立实现）。

## 范围

- `src/handlers.ts`
- `src/providers/mlx.ts`（删除）
- `src/runners/mlx.ts`（删除）
- `src/routes/commands.ts`
- `src/config/workspace.ts`
- `src/index.ts`
- `test/*`（删除或改写 MLX 专属用例）
- `README.md` / `.env.example` / `docs/*`

## 非范围

- 不改 PI/SOUL 主语义
- 不改 tool loop 协议（只改 provider 入口）

## 实施项

### R3.1 删除运行时实现
- 删除 `src/providers/mlx.ts`
- 删除 `src/runners/mlx.ts`
- 移除 `handlers.ts` 中 `currentRunner === "mlx"` 分支与动态 import
- 移除 `index.ts` 里 MLX_AUTO_MANAGE / 启停逻辑

### R3.2 收口配置与路由
- `workspace.ts` 删除 `runner.default` 的 `mlx` 类型与 `mlx.*` 配置键
- 删除 `getMlxConfig` / `setMlxConfig`（若存在）
- `commands.ts` 删除 `/model mlx` 文案与 validRunners 的 `mlx`
- PI 提示文本从 `lmstudio/mlx` 收口为 `lmstudio`

### R3.3 清理测试与文档
- 删除 `test/providers.mlx.test.ts`
- 把 `handlers`、`context`、`logger` 等测试中的 `mlx` 分支改为 `lmstudio` 或移除
- README/.env/docs 删除 MLX 操作说明

### R3.4 禁回流锁
- 新增 anti-regression（或扩展现有锁）：
  - `src` 中不得出现 `from "./providers/mlx"`、`from "./runners/mlx"`
  - `workspace.ts` 不得出现 `mlx.baseUrl|mlx.modelId|mlx.maxTokens|mlx.temperature|mlx.topP`
  - `commands.ts` 不得出现 `/model mlx`

## 硬验收

| 验收项 | 命令/检查 | 结果 |
|---|---|---|
| TypeScript 编译 | `npx tsc --noEmit` | ✅ |
| 单元/集成测试 | `npm test`（0 fail） | ✅ |
| 文档同步检查 | `npm run docs:check` | ✅ |
| 代码扫描 | `rg -n "\\bmlx\\b|MLX" src` 仅允许 `mlx-whisper`（ASR/TTS 独立能力） | ✅ |
| 命令一致性 | `/help` 不再出现 `mlx` runner | ✅ |

## 回滚

```bash
git checkout -- src/handlers.ts src/routes/commands.ts src/config/workspace.ts src/index.ts test README.md .env.example docs
git checkout -- src/providers/mlx.ts src/runners/mlx.ts
```
