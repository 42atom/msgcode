---
id: 0029
title: Schedule 聊天投递不应走 tmux - reply-to-same-chat 被错误落成 tmuxMessage
status: done
owner: agent
labels: [bug, schedule, delivery]
risk: high
scope: src/config/schedules.ts, src/jobs/scheduler.ts, src/jobs/types.ts
plan_doc: docs/design/plan-260308-schedule-chat-delivery-not-tmux.md
links:
  - /Users/admin/GitProjects/msgcode/issues/0022-scheduler-skill-bash-mainline.md
  - /Users/admin/GitProjects/msgcode/issues/0025-schedule-route-dependency-explicit.md
created: 2026-03-08
due:
---

## Context

- Issue 0022/0025 完成了 scheduler skill 单真相源收口
- 当前遗留问题：`delivery.mode=reply-to-same-chat` 的任务被错误投递到 tmux 通道

## Goal / Non-Goals

### Goals
- 查清 `reply-to-same-chat` 为什么被投影成 `tmuxMessage`
- 修成：reply-to-same-chat 直接走聊天通道
- 不依赖 tmux session

### Non-Goals
- 不重构整个 scheduler 引擎
- 不改自然语言 skill 主链
- 不改 browser/memory/thread/event-queue

## Plan

- [x] 创建 issue + plan
- [x] 拿代码根因
- [x] 修投影逻辑（Payload 类型 + scheduleToJob）
- [x] 修执行逻辑（executeJob + executeChatMessageJob）
- [x] 补测试（45 schedule tests pass）
- [x] 真机验证（status=ok）

## Acceptance Criteria

- `reply-to-same-chat` 不再落成 tmux 通道
- schedule 投影与执行都直接走聊天消息链
- 不需要依赖 tmux session 也能正常投递
- 测试与真机验证均有证据

## Evidence

### 问题确认
1. schedule 文件已创建：`delivery.mode = reply-to-same-chat`
2. jobs.json 投影已创建
3. runs.jsonl 显示触发过，但失败原因：`TMUX_SESSION_DEAD`

### 根因分析
- 待查：`delivery.mode=reply-to-same-chat` → `payload.kind=tmuxMessage` 的映射点

## Notes

### 已知坑
1. 不要用 fallback 兜去 tmux
2. 不要因为历史 payload 兼容就保留错误默认行为
3. 不要把"chat delivery"再包一层新中间层

## Links

- Plan: `docs/design/plan-260308-schedule-chat-delivery-not-tmux.md`
- Issue: `issues/0025-schedule-route-dependency-explicit.md`
