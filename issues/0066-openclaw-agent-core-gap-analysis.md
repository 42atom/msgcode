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
  - `docs/notes/research-260310-future-architecture-node.md`
  - `docs/notes/research-260310-openclaw-terminal-agent-harness.md`
  - `docs/notes/research-260310-thin-core-plugin-topology.md`
- 2026-03-10 Phase 1 已落地：
  - 新增 `src/runtime/run-types.ts`、`src/runtime/run-store.ts`
  - 普通消息、`/task run|resume`、heartbeat 任务续跑、schedule 执行都会生成统一 `runId/source/status/startedAt/endedAt`
  - 普通消息链把 `runId` 复用为 agent `traceId`，没有把 light run 强行升级成 task
  - 评审修正：schedule 的 `skipped` run 不再伪装成 `completed`，统一映射到失败终态，避免 run 指标高估成功率
- 2026-03-10 Phase 2 已落地：
  - 新增 `src/runtime/session-key.ts`，把 `chatId + workspace + channel` 收口为稳定 `sessionKey`
  - `beginRun()` 现在会统一解析并落盘 `sessionKey`，四条 run 主链不需要再各自维护第二套 session 口径
  - `sessionKey` 不再只是临时 `chatId` 别名；同一 chat 的 message / `/task` / heartbeat / schedule 会落到同一 key
  - schedule 缺少 route/workspace 时走 fail-closed 的 `orphan` sessionKey，不猜工作区
  - 评审补正：`src/logger/file-transport.ts` 已补 `sessionKey` 文本日志输出，避免出现“JSONL 有 sessionKey、文本日志没有”的口径缺口
- 2026-03-10 Phase 3 已落地：
  - 新增 `src/runtime/context-policy.ts`，把 `summary / recent window / task checkpoint / compact / tool preview clip` 收口到统一 helper
  - 普通消息链与 task 续跑链都改为调用 `assembleAgentContext()`，不再各自维护第二套 context path；task 续跑现在也会透传 `includeSoulContext + sessionKey + soulContext`
  - `handlers.ts` 不再独占 compaction 主逻辑；compact 仍保留 70% 软阈值、85% 硬保护和保留最近 10 条消息的行为
  - `src/agent-backend/prompt.ts` 仅重导出统一预算装配器，`src/agent-backend/tool-loop.ts` 复用同一 `clipToolPreviewText()` 规则
- 2026-03-10 Phase 4 已落地：
  - 新增 `src/runtime/run-events.ts`，把最小事件集 `run:start / run:tool / run:assistant / run:block / run:end / run:error` 收口到 append-only JSONL
  - Run Core 现在会在 `beginRun()/finish()` 自动发 `run:start / run:end / run:error`，事件文件默认落到 `~/.config/msgcode/run-core/run-events.jsonl`，可由 `MSGCODE_RUN_EVENTS_FILE_PATH` 覆盖
  - `src/agent-backend/routed-chat.ts` 会基于 tool-loop 结果发 `run:tool / run:assistant / run:block`；`src/handlers.ts` 与 `src/commands.ts` 会统一透传 `runContext`
  - `src/runtime/task-supervisor.ts` 只在非 verify 驱动的 blocked 场景补 `run:block`，避免再长 task-only 事件体系
- 验证：
  - `PATH="$HOME/.bun/bin:$PATH" bun test test/p6-agent-run-core-phase4-run-events.test.ts`
  - `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-6-8-r4b-window-summary-injection.test.ts test/p5-7-r9-t2-context-budget-compact.test.ts test/p5-7-r12-agent-relentless-task-closure.test.ts test/p5-7-r12-t9-mainline-quota-continuation-smoke.test.ts test/p6-agent-run-core-phase1.test.ts test/p6-agent-run-core-phase2-session-key.test.ts test/p6-agent-run-core-phase3-context-policy.test.ts test/p6-agent-run-core-phase4-run-events.test.ts`
  - `PATH="$HOME/.bun/bin:$PATH" bun test test/p6-agent-run-core-phase3-context-policy.test.ts`
  - `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r27-context-budget-assembler.test.ts`
  - `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-6-8-r4b-window-summary-injection.test.ts`
  - `PATH="$HOME/.bun/bin:$PATH" bun test test/logger.file-transport.test.ts`
  - `PATH="$HOME/.bun/bin:$PATH" bun test test/p6-agent-run-core-phase2-session-key.test.ts`
  - `PATH="$HOME/.bun/bin:$PATH" bun test test/p6-agent-run-core-phase1.test.ts`
  - `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r12-agent-relentless-task-closure.test.ts`
  - `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r12-t9-mainline-quota-continuation-smoke.test.ts`
  - `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r18-schedule-refresh-on-mutation.test.ts`
- 额外检查：
  - `npx tsc --noEmit` 仍失败，但报错来自仓库既有未修项目：`src/feishu/transport.ts`、`src/routes/cmd-model.ts`、`src/routes/cmd-schedule.ts`、`src/routes/cmd-tooling.ts`

## Links

- Research: `docs/notes/research-260310-openclaw-agent-core-gap.md`
- Research: `docs/notes/research-260310-openclaw-terminal-agent-harness.md`
- Plan: `docs/design/plan-260310-agent-core-gap-vs-openclaw.md`
- Task: `docs/tasks/p6-agent-core-run-core-dispatch-pack.md`
