---
id: 0049
title: /help 命令单一注册表收口方案
status: done
owner: agent
labels: [refactor, docs]
risk: medium
scope: 群聊 /help、未知命令提示与 docs sync 的命令真相源收口
plan_doc: aidocs/design/plan-260309-help-command-single-source.md
links: [docs/tasks/p5-7-r13-help-command-single-source.md]
---

## Context

- 当前群聊 `/help` 文案定义在 `src/routes/cmd-info.ts`，为手写多行字符串。
- 真实命令入口分散在 `src/routes/commands.ts` 与 `src/handlers.ts`。
- 未知命令提示、`scripts/check-doc-sync.ts`、`help-docs` 又各自维护一份命令视图，已出现漂移。
- 最近一次核对已证明 `/help` 曾遗漏真实命令，说明“文案驱动真相源”不稳。
- 用户新增约束：系统要尽量做薄，优先就地收口，不为 help 再新造一层。

## Goal / Non-Goals

- Goal: 形成一个最小、可执行、可回滚的 `/help` 收口方案文档。
- Goal: 明确 `/help` 相关代码如何写得更简单、更优雅。
- Non-Goals: 本轮不直接实现完整重构，不把 CLI `help-docs` 与群聊 `/help` 强行合并成一个大而全平台。

## Plan

- [x] 盘点 `/help`、路由入口、未知命令提示、docs sync 的现状与漂移点
- [x] 评估至少两种收口方案并给出推荐
- [x] 输出正式方案文档
- [x] 评审方案并决定是否进入实现

## Acceptance Criteria

1. 方案文档明确现状问题、Occam Check、推荐决策、步骤、风险与回滚。
2. 文档包含实际拟改文件路径和最小代码骨架示例。
3. 方案区分“最小可删版本”和“扩展版本”。

## Notes

- Sources:
  - `src/routes/cmd-info.ts`
  - `src/routes/commands.ts`
  - `src/handlers.ts`
  - `src/cli/help.ts`
  - `scripts/check-doc-sync.ts`
  - `docs/release/v2.3.0.md`
- Direction:
  - 薄优先：以 `cmd-info.ts` 内聚 help 元数据为默认方案
- Deliverable: `aidocs/design/plan-260309-help-command-single-source.md`
- Implementation:
  - `src/routes/cmd-info.ts`
  - `src/routes/commands.ts`
  - `scripts/check-doc-sync.ts`
  - `test/routes.commands.test.ts`
- Tests:
  - `npm test -- --runInBand test/routes.commands.test.ts`
  - `npm test -- --runInBand test/routes.commands.test.ts test/docs.sync.test.ts test/handlers.runtime-kernel.test.ts`
  - `NODE_OPTIONS='--import tsx' node - <<'NODE' ... checkDocSync() ... NODE`
- Result:
  - `test/routes.commands.test.ts`: 57 pass / 0 fail
  - `test/routes.commands.test.ts test/docs.sync.test.ts test/handlers.runtime-kernel.test.ts`: 71 pass / 0 fail
  - `checkDocSync()` 与本轮直接相关项：`missing=[]`, `extra=[]`, `violations=[]`
- Review Follow-up:
  - P1：`src/handlers.ts` 的真实未知 slash 主链已改为复用 `renderUnknownCommandHint()`
  - P3：`scripts/check-doc-sync.ts` 改为按 slash 命令边界提取，`/binary` 不再靠忽略名单止血
- Known Gap:
  - `npm run docs:check` 仍被仓库既有 issue/plan 协议历史欠账阻塞,不属于本轮 help 收口改动

## Links

- Plan: `aidocs/design/plan-260309-help-command-single-source.md`
- Task: `docs/tasks/p5-7-r13-help-command-single-source.md`
