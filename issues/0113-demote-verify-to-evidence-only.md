---
id: 0113
title: 将 verify 降为纯证据层
status: done
owner: agent
labels: [refactor, architecture]
risk: high
scope: runtime task-supervisor 与 run-events 不再把 verify 当作第二裁判
plan_doc: docs/design/plan-260312-demote-verify-to-evidence-only.md
links: []
---

## Context

`finish supervisor` 已退出热路径后，`runVerifyPhase()` 仍然通过 `verifyResult` 抢执行权：`task-supervisor` 会因 verify 失败把任务从 completed 改成 blocked，`run-events` 也会把 verify 失败发成 `run:block`。同时 `updateTaskResult()` 还要求 completed 必须带 verifyEvidence，否则强行退回 running。这说明 verify 还在充当第二层裁判，而不是单纯证据。

## Goal / Non-Goals

### Goal

- 让 verify 只保留证据语义，不再改任务状态
- completed 不再强依赖 verifyEvidence
- `run:block` 只服务真实 blocked，不再把 verify 失败冒充成 block

### Non-Goals

- 本轮不删除 `runVerifyPhase()` 本身
- 本轮不删除 `verifyResult` / `verifyEvidence` 数据结构
- 本轮不改其他预算/安全边界

## Plan

- [x] 新建 `0113` issue 与对应 plan，冻结边界
- [x] 修改 `task-supervisor`：删除 verify gate 对 completed/blocked 的状态劫持
- [x] 修改 `run-events`：verify 失败不再发 `run:block`
- [x] 更新相关类型注释与测试锁
- [x] 跑定向测试、类型检查和 docs:check

## Acceptance Criteria

- verify 失败不再把任务状态改成 blocked
- completed 不再因缺少 verifyEvidence 被强制退回 running
- verify 证据仍会保留在结果与任务记录里

## Notes

- 已实现：
  - `task-supervisor` 不再因 `verifyResult.ok === false` 把任务打成 `blocked`
  - `updateTaskResult()` 中 completed 不再强依赖 `verifyEvidence`
  - `run-events` 中 verify 失败不再发 `run:block`
  - `task-types` 注释已收口为“verify 证据可选”
- 验证：
  - `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r12-agent-relentless-task-closure.test.ts test/p5-7-r12-t9-mainline-quota-continuation-smoke.test.ts test/p6-agent-run-core-phase1.test.ts test/p6-agent-run-core-phase2-session-key.test.ts test/p6-agent-run-core-phase4-run-events.test.ts`
    - `37 pass / 0 fail`
  - `npx tsc --noEmit`
    - `EXIT:0`
  - `npm run docs:check`
    - `✓ 文档同步检查通过`

## Links

- /Users/admin/GitProjects/msgcode/issues/0103-ai-os-foundation-roadmap.md
- /Users/admin/GitProjects/msgcode/issues/0112-remove-finish-supervisor-hot-path.md
