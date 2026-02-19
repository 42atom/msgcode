# P5.6.1：运行时内核收敛（`handlers` 只做路由/编排入口）

## 背景

当前 `src/handlers.ts` 职责过重：路由、PI 编排、window/pending 管理、skill 触发、降级回执混在一处。  
结果是改动高风险、回归成本高、测试隔离困难。

本任务目标是“薄壳化 handlers”，不改功能语义，只做职责搬迁与边界收口。

## 冻结决策

1. `handlers.ts` 只保留入口编排，不承载业务实现。
2. 现有功能语义零变化（PI/skill/memory/window/pending 不改口径）。
3. 日志字段不能回退：`autoSkill`、`autoSkillResult`、`toolCallCount`、`executionMode`。
4. 不允许为过测跳过主链（不得绕过 bridge，不得删除只读降级链路）。

## 目标

1. 将 runtime 业务逻辑拆到独立 orchestrator 模块。
2. `handlers.ts` 行数压缩到 `< 800`（建议 `< 500`）。
3. 保持三门 gate 全绿。

## 范围

- `src/handlers.ts`
- `src/runtime/*`（新增）
- `test/*`（回归锁）
- `docs/tasks/README.md`（索引同步）

## 非范围

- 不改命令语义
- 不改 tool schema
- 不改 provider 策略
- 不做 UI 层工作

## 实施拆分

### P5.6.1.1 基线锁

- 记录当前基线：`tsc`、`test`、`docs:check`。
- 锁定 P0（按当前分支实现）：SOUL 路径与注入口径不可回退（禁止引入 `.soul` 路径；保持 `~/.config/msgcode/souls/` 与工作区 `.msgcode/SOUL.md` 语义一致）。

### P5.6.1.2 抽离 Session 编排

- 新建 `src/runtime/session-orchestrator.ts`。
- 收口 window/pending 的读写与消费流程。
- `handlers.ts` 只调用 orchestrator 接口。

### P5.6.1.3 抽离 PI 编排

- 范围限定：仅处理 `handlers` 中现存的 runtime PI 逻辑。
- 若当前分支 `handlers` 中不存在 PI runtime 实现，则本项记为 `N/A`，禁止为“完成任务”去改 `src/routes/commands.ts` 的 `/pi` 命令面。
- 保持 `executionMode` 观测字段语义不变（如存在该字段）。

### P5.6.1.4 抽离 Skill 编排

- 新建 `src/runtime/skill-orchestrator.ts`。
- 统一 auto skill / `run_skill` / `/skill run` 入口编排（执行器仍保持单一真相源）。

### P5.6.1.5 handlers 薄壳化与回归锁

- `handlers.ts` 保留：入口分流、依赖注入透传、统一回执封装。
- 增加/更新 `test/handlers.runtime-kernel.test.ts`，锁“只编排不执行业务”契约。

## 硬验收

| 验收项 | 命令/检查 | 结果 |
|---|---|---|
| TypeScript 编译 | `npx tsc --noEmit` | ✅ |
| 单元/集成测试 | `npm test`（0 fail） | ✅ |
| 文档同步检查 | `npm run docs:check` | ✅ |
| 体量目标 | `src/handlers.ts < 800 行` | ✅ |
| 功能一致性 | `/pi on`、自然语言 skill、`继续`、`/clear` 冒烟通过 | ✅ |

## 提交要求

- 至少 3 个提交：
  - `extract-session-orchestrator`
  - `extract-pi-skill-orchestrator`
  - `handlers-thin-shell-and-tests`
- 每个提交后跑三门 gate。

## 回滚

```bash
git checkout -- src/handlers.ts src/runtime test
```
