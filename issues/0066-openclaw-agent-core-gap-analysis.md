---
id: 0066
title: OpenClaw 对标下的 Agent Core 差距分析与收口方案
status: doing
owner: agent
labels: [research, architecture, agent-core]
risk: medium
scope: agent-backend/runtime/task/session/context 主链对标 OpenClaw
plan_doc: docs/design/plan-260310-agent-core-gap-vs-openclaw.md
links: []
---

## Context

用户明确要求：当前不要继续分散到页面、移动端或更多通道，而是先把 `Agent Core` 做到“像 OpenClaw 一样，能完成复杂任务、持续活跃”。

当前问题不是“功能清单少了几个”，而是还不清楚 `msgcode` 与 `openclaw` 的结构差距具体在哪，哪些该学，哪些不该学。

## Goal / Non-Goals

### Goal

- 明确 `msgcode` 与 `openclaw` 在 Agent Core 上的关键差距
- 给出一条不做厚控制面的收口方案
- 为后续 Agent Core 主线实施提供清晰北极星
- 拆出可直接派发的执行任务序列

### Non-Goals

- 本轮不实现 gateway / mobile / PWA / pairing
- 本轮不新增 transport platform
- 本轮不直接改代码行为

## Plan

- [x] 阅读 `openclaw` 的 agent loop / session / compaction / queue / heartbeat 关键文档
- [x] 对照 `msgcode` 当前 task / heartbeat / context / tool-loop 主链
- [x] 输出 research 文档，明确差距与启发
- [x] 输出 plan 文档，给出最小可行收口方案
- [x] 输出任务拆解包，作为执行同学唯一任务口径

## Acceptance Criteria

1. 文档能明确回答：`msgcode` 和 `openclaw` 的差距到底在哪
2. 文档能明确区分：哪些是终局相似，哪些是当前不能抄的工程重量
3. 推荐方案必须符合“做薄、单一主链、不新增厚控制面”

## Notes

- 当前已有相关方向文档：
  - `docs/design/plan-260310-long-running-agent-context-smoothing.md`
  - `docs/design/plan-260310-post-imessage-channel-strategy.md`
  - `AIDOCS/notes/future-architecture-node-260310.md`

## Links

- Research: `docs/notes/research-260310-openclaw-agent-core-gap.md`
- Plan: `docs/design/plan-260310-agent-core-gap-vs-openclaw.md`
- Task: `docs/tasks/p6-agent-core-run-core-dispatch-pack.md`
