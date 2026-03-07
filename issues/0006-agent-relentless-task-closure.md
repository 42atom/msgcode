---
id: 0006
title: Agent 追打型未完成任务闭环
status: doing
owner: agent
labels: [feature, refactor, docs]
risk: high
scope: runtime/agent/jobs/heartbeat/event-queue/task-state
plan_doc: docs/design/plan-260306-agent-relentless-task-closure.md
links:
  - docs/tasks/p5-7-r8-agent-domain.md
  - docs/tasks/p5-7-r12-t1-heartbeat-event-wake.md
  - docs/tasks/p5-7-r12-t2-scheduler-self-heal-hot-reload.md
  - docs/tasks/p5-7-r12-t3-verify-phase-mainline.md
  - docs/tasks/p5-7-r12-t4-event-queue-persistence.md
  - docs/tasks/p6-msgcode-refactor-master-plan.md
created: 2026-03-06
---

## Context

- 当前 `msgcode` 在单轮内具备一定“持续执行”能力：`runAgentToolLoop()` 会在一次请求内循环推进多次工具调用，并记录 `actionJournal`。
- 当前 `msgcode` 也具备部分长期运行底座：
  - heartbeat 已落地，但当前 tick 回调仅做观测日志，未接任务恢复
  - scheduler 已具备自愈与 stuck cleanup
  - 对话线程与 tmux 会话均可落盘/恢复
- 但系统仍不具备“像 OpenClaw 一样，对未完成任务持续追打直到完成”的闭环能力。关键缺口：
  - 没有真正的 agent 任务状态机
  - 没有面向 agent 任务的持久化队列与重启恢复
  - 没有“未完成/可重试/需人工接力/已完成”的统一判定
  - heartbeat 尚未成为任务续跑器
- 已有前置任务与草案分散存在：
  - `R8`：agent run/status 状态机规划
  - `R12-T1`：heartbeat 底座
  - `R12-T3`：verify 阶段入主链
  - `R12-T4`：事件队列持久化与重启恢复

## Goal / Non-Goals

- Goal: 落地一个单 chat、单活跃任务的“追打型任务闭环” MVP，使 `msgcode` 能在无新用户消息情况下持续推进未完成任务，直到进入终态。
- Non-Goals: 不实现多代理协作；不引入外部 MQ/Redis；不做 UI；不在本单实现复杂任务规划器。

## Plan

- [x] 建立持久化任务状态机：`pending/running/blocked/completed/failed/cancelled`
- [x] 建立任务存储与事件队列持久化，支持重启恢复
- [x] 将 heartbeat 从“只观测”升级为任务续跑入口
- [x] 将 verify 结果纳入终态判定，禁止“未验证即完成”
- [x] 建立最小控制面：状态查询、阻塞原因、取消/恢复

## Acceptance Criteria

1. 同一 chat 下，用户发起一个需要多轮推进的任务后，系统可在无新消息情况下继续推进，直到进入 `completed|failed|blocked|cancelled` 之一。
2. 进程重启后，`pending|running|blocked` 的任务可被恢复，不会静默丢失。
3. 无验证证据时，任务不能进入 `completed`。
4. 遇到需人工接力场景时，任务进入 `blocked`，并保留恢复上下文。
5. 系统能输出结构化任务诊断：`taskId/status/attemptCount/nextWakeAtMs/lastErrorCode/blockedReason`。

## Notes

- Docs:
  - `docs/tasks/p5-7-r8-agent-domain.md`
  - `docs/tasks/p5-7-r12-t1-heartbeat-event-wake.md`
  - `docs/tasks/p5-7-r12-t3-verify-phase-mainline.md`
  - `docs/tasks/p5-7-r12-t4-event-queue-persistence.md`
- Code:
  - `src/agent-backend/tool-loop.ts`：`verify` 已进入主链并返回 `verifyResult`
  - `src/runtime/task-supervisor.ts`：新增公开 heartbeat 入口，`pending|running` 均可续跑
  - `src/commands.ts`：heartbeat 与 task-supervisor 统一接线，不再发生回调覆盖
  - `src/steering-queue.ts`：持久化恢复按 `queueType` 恢复到 `steer/followUp`
  - `src/jobs/scheduler.ts`：已有 stuck cleanup / idle poll / re-arm，可复用
- 2026-03-06 修复阻断项：
  - 修复 `HeartbeatRunner.onTick()` 被后续日志回调覆盖，导致 supervisor 实际收不到 tick 的问题
  - 修复 `running` 任务重启后不会再次进入 runnable 集合的问题
  - 修复 `steer` 事件重启恢复后被错误降级为 `followUp` 的语义漂移
  - `stopBot()` 已补 `taskSupervisor.stop()`，避免 supervisor 生命周期悬空
- Tests:
  - `npx tsc --noEmit`：通过
  - `npm test -- test/p5-7-r12-agent-relentless-task-closure.test.ts`：`17 pass / 0 fail`
  - `npm test -- test/context.steering.test.ts`：`18 pass / 0 fail`
  - `npm run docs:check`：通过
- 风险收口：
  - 默认只支持单 chat 单活跃任务，先收口状态空间
  - 对 recoverable error 要有明确预算，避免无限自旋
  - 遇到人机接力，默认 fail-closed 到 `blocked`

## Links

- Plan: `docs/design/plan-260306-agent-relentless-task-closure.md`
- Task: `docs/tasks/p5-7-r8-agent-domain.md`
- Task: `docs/tasks/p5-7-r12-t1-heartbeat-event-wake.md`
- Task: `docs/tasks/p5-7-r12-t3-verify-phase-mainline.md`
- Task: `docs/tasks/p5-7-r12-t4-event-queue-persistence.md`
