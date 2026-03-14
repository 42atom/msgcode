# P5.6.5：命令层最终瘦身（`commands.ts` 只留注册+分发+fallback）

## 背景

`src/routes/commands.ts` 当前体量约 2694 行，职责混杂（解析、命令实现、帮助渲染、配置写入）。  
P5.6.5 目标是把命令层收敛为“薄壳入口”，为 P5.6.6 的 DI 与回归锁提供稳定边界。

## 目标

1. `commands.ts` 仅保留三类职责：注册、分发、fallback。
2. 命令实现按域拆分到 `cmd-*.ts`，避免单文件耦合。
3. 行为零变化（命令语义、文案、权限逻辑不漂移）。

## 范围

- `src/routes/commands.ts`
- `src/routes/cmd-*.ts`（新增）
- `src/routes/store.ts`（按需轻量改动）
- `test/routes.commands.test.ts`（回归锁补齐）
- `docs/tasks/README.md`（索引同步）

## 非范围

- 不修改 `handlers.ts` 运行时编排（属于 P5.6.6+）
- 不改 SOUL/Memory/ToolLoop 语义
- 不引入新命令

## 实施步骤

### R1 建立薄壳骨架（P0）

- `commands.ts` 保留：
  - `isRouteCommand`
  - `parseRouteCommand`
  - `handleRouteCommand`（只分发）
- 新增注册表与共享类型（若已有则复用，不重复造轮子）。

### R2 按域迁移（P0）

建议迁移顺序（风险低到高）：

1. 信息域：`/help` `/info` `/chatlist`
2. 配置域：`/model` `/policy` `/mem`
3. 业务域：`/soul` `/schedule` `/reload`
4. 管理域：`/owner` `/owner-only` `/bind` `/where` `/unbind`

每迁移一域，立即删除 `commands.ts` 对应实现分支。

### R3 回归锁（P0）

- 三段一致性锁：`isRouteCommand -> parseRouteCommand -> handleRouteCommand`。
- `/help` 与注册表可见命令一致性锁。
- 未知命令 fallback 文案锁。

### R4 收口（P1）

- `commands.ts` 行数目标：**< 800 行**。
- 若首轮无法达成，需输出残留块清单与下一轮拆分计划（不可硬拖）。

## 硬验收

| 验收项 | 命令/检查 | 结果 |
|---|---|---|
| TypeScript 编译 | `npx tsc --noEmit` | ✅ |
| 单元/集成测试 | `npm test`（0 fail） | ✅ |
| 文档同步检查 | `npm run docs:check` | ✅ |
| 文件规模 | `wc -l src/routes/commands.ts` < 800 | ✅ |
| 行为一致性 | 关键命令冒烟（`/help` `/model` `/soul` `/reload`） | ✅ |

## 风险与约束

- 禁止“先复制再保留旧实现”导致双实现并存。
- 每次迁移必须同步删原分支，避免行为漂移。
- 只接受小步提交（每域至少 1 次独立提交）。

## 回滚

```bash
git checkout -- src/routes/commands.ts src/routes/store.ts src/routes/cmd-*.ts test/routes.commands.test.ts
```
