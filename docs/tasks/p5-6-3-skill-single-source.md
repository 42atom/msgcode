# P5.6.3：Skill 执行单一真相源

## 背景

当前两条触发路径已在执行层汇合到 `runSkill()`：

- 路径 A：`/skill run` -> `runtime/skill-orchestrator` -> `skills/auto.ts:runSkill()`
- 路径 B：自然语言 -> `lmstudio tool_calls(run_skill)` -> `runSkill()`

功能执行无漂移，但日志字段与模块名存在差异，且缺少“单一入口”防回流锁。

## 目标

1. 锁定“所有 Skill 执行最终调用 `runSkill()`”。
2. 补回归测试，防止新增第二条执行链。
3. 统一观测字段（`autoSkill` / `autoSkillResult` / `toolCallCount`）输出口径。

## 范围

- `src/runtime/skill-orchestrator.ts`
- `src/lmstudio.ts`
- `src/tools/bus.ts`
- `test/*`（新增/更新回归锁）

## 非范围

- 不改 Skill 业务定义
- 不改 SOUL 加载逻辑
- 不改 Tool Bus 权限策略

## 实施项

### R1 单一执行链锁定（P0）

- 明确规定：禁止直接新增 `runAutoSkill()` 主路径；自然语言只能通过 `run_skill` tool_call 执行。
- 统一执行真相源：最终执行必须落到 `skills/auto.ts:runSkill()`。

### R2 回归锁（P0）

- 测试锁 1：`/skill run` 路径调用 `runSkill()`。
- 测试锁 2：自然语言 `run_skill` tool_call 路径调用 `runSkill()`。
- 测试锁 3：静态扫描禁止新增第二条 skill 执行链（白名单明确）。

### R3 观测对齐（P1）

- 对齐日志字段：`autoSkill`、`autoSkillResult`。
- 自然语言路径额外保留 `toolCallCount`，但字段名与语义一致。
- 明确日志来源模块，用于定位（`lmstudio`/`skill-orchestrator`/`tools-bus`）。

## 硬验收

| 验收项 | 命令/检查 | 结果 |
|---|---|---|
| TypeScript 编译 | `npx tsc --noEmit` | ✅ |
| 单元/集成测试 | `npm test`（0 fail） | ✅ |
| 文档同步检查 | `npm run docs:check` | ✅ |
| 执行一致性 | 两路径均命中 `runSkill()` | ✅ |
| 防回流锁 | 第二执行链静态扫描失败即阻断 | ✅ |
| 观测一致性 | 日志字段口径一致 | ✅ |

## 风险

- `lmstudio.ts` 与 `tools/bus.ts` 都有 `run_skill` 路径，后续需在 `P5.6.4+` 继续收敛调度入口。

## 临时对齐（止血）

- `mlx.ts` 使用 `getCapabilities("lmstudio")` 和 `getInputBudget("lmstudio")`（非 "mlx"）
- `handlers.ts` runner 类型包含 "mlx"（保持兼容）
- 完整 MLX 退役见独立任务单

## 回滚

```bash
git checkout -- src/runtime/skill-orchestrator.ts src/lmstudio.ts src/tools/bus.ts test
```
