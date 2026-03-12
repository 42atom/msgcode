---
id: 0105
title: 将 finish supervisor 降为纯观测器
status: done
owner: agent
labels: [refactor, architecture]
risk: high
scope: agent-backend tool-loop 收尾阶段移除 finish supervisor 的二次裁判权
plan_doc: docs/design/plan-260312-finish-supervisor-observability-only.md
links: []
---

## Context

`finish supervisor` 当前仍是二次裁判：它能要求 `CONTINUE`、能阻塞完成、能把模型重新拉回循环，甚至最终返回 `FINISH_SUPERVISOR_BLOCKED`。这已经直接违背“AI 是唯一主执行者”的仓库级宪章。用户要求继续沿着出发点推进，因此这条线现在必须从“裁判层”降为“观测层”。

## Goal / Non-Goals

### Goal

- 保留 `finish supervisor` 的日志与 action journal 证据
- 删除它要求继续、阻塞完成、回灌 CONTINUE 文本的裁判权
- 让用户最终答复重新只由模型决定

### Non-Goals

- 本轮不删除 supervisor 配置字段
- 本轮不删除所有 supervisor 相关代码
- 本轮不改 task-supervisor 心跳续跑逻辑

## Plan

- [x] 新建 `0105` issue 与对应 plan，冻结本轮边界
- [x] 把 `finish supervisor` 从“可要求 CONTINUE / block”改为“只记录 PASS/CONTINUE 审计结果”
- [x] 删除 tool-loop 中的 `buildFinishSupervisorContinuationMessage()` / `buildFinishSupervisorBlockedAnswer()` 行为分支
- [x] 更新 `p5-7-r20` 和 `p5-7-r10` 回归锁，改成“记录但不裁判”
- [x] 跑定向回归、类型检查和 docs:check

## Acceptance Criteria

- `finish supervisor` 不再触发二次续跑
- `finish supervisor` 不再返回 `FINISH_SUPERVISOR_BLOCKED`
- actionJournal / 日志仍保留 `finish-supervisor` 审计记录

## Notes

- 已实现：
  - `finish supervisor` 已从二次裁判降为纯观测器：仍会复核并写入 `actionJournal` / 日志，但不会再要求 CONTINUE、不会阻塞完成、不会返回 `FINISH_SUPERVISOR_BLOCKED`
  - `tool-loop` 中的 `buildFinishSupervisorContinuationMessage()` / `buildFinishSupervisorBlockedAnswer()` 与相关控制流已删除
  - `p5-7-r20` 回归锁已改成“记录但不裁判”的新语义
- 验证：
  - `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r20-minimal-finish-supervisor.test.ts test/p5-7-r10-minimax-anthropic-provider.test.ts test/p5-7-r3h-tool-failure-diagnostics.test.ts test/p5-7-r3g-multi-tool-loop.test.ts`
    - `27 pass / 0 fail`
  - `npx tsc --noEmit`
    - `EXIT:0`
  - `npm run docs:check`
    - `✓ 文档同步检查通过`

## Links

- /Users/admin/GitProjects/msgcode/issues/0104-tool-loop-remove-fallback-answer.md
- /Users/admin/GitProjects/msgcode/issues/0103-ai-os-foundation-roadmap.md
