---
id: 0091
title: 发布门槛收口：对齐 merge 后失真回归锁到当前真相源
status: done
owner: agent
labels: [test, docs, refactor]
risk: medium
scope: browser/context-policy/agent-backend 等失真回归锁对齐
plan_doc: docs/design/plan-260311-release-gate-stale-regression-lock-alignment.md
links: []
---

## Context

`gmail-readonly` 退场后，`bun test` 仍剩一批失败，但大部分不是现网主链真的坏了，而是测试继续锁在旧实现上：

1. browser tool bus 还按旧 orchestrator/baseUrl 语义写。
2. memory/context-policy 测试仍要求 `handlers.ts` 直接管理 `loadWindow/loadSummary/extractSummary`。
3. `AgentRoutedChatResult / AgentToolLoopOptions` 类型测试用运行时 import 验证被擦除的 TS 类型。
4. 默认视觉模型与 `ToolName` 单一真相源测试仍锁旧文件/旧写法。
5. 部分 `assembleAgentContext()` 测试因能力探测触发运行时网络探测而超时，应明确切到本地 env override 口径。

## Goal / Non-Goals

### Goal

- 让回归锁重新对齐当前真实实现
- 优先修改测试，不无谓改主代码
- 恢复 `bun test` 的可信度

### Non-Goals

- 不重做 browser/runtime/context-policy 架构
- 不为兼容旧测试而把主代码退回旧设计
- 不顺手扩 scope 到所有历史文档

## Plan

- [x] 新建 issue / plan，冻结范围
- [x] 收口默认模型 / ToolName 老路径测试
- [x] 收口 browser tool bus 到 patchright/chrome-root 主链
- [x] 收口 memory/context-policy/agent-first 类型锁到当前真相源
- [x] 通过 env override 消除 context-policy 测试的非必要网络探测超时
- [x] 跑针对性测试并更新剩余失败清单

## Acceptance Criteria

- browser tool bus 测试不再假设 orchestrator/baseUrl 旧语义
- memory/context-policy 测试改为锁 `runtime/context-policy.ts` 与 `assembleAgentContext()`
- agent-first 类型测试不再试图在运行时 import TS 类型
- `bun test` 通过
- `npm run test:all` 继续通过

## Notes

- Changed:
  - `test/p5-7-r6b-default-model-preference.test.ts`
  - `test/p5-6-8-r4h-tool-root-fail-fantasy.test.ts`
  - `test/p5-7-r7a-browser-tool-bus.test.ts`
  - `test/p5-7-r9-t3-memory-persistence-clear-boundary.test.ts`
  - `test/p5-7-r12-t10-agent-first-router-second.test.ts`
  - `test/p6-agent-run-core-phase3-context-policy.test.ts`
  - `test/p6-feishu-message-context-phase1.test.ts`
  - `test/p6-feishu-message-context-phase2.test.ts`
- Tests:
  - `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r6b-default-model-preference.test.ts test/p5-6-8-r4h-tool-root-fail-fantasy.test.ts test/p5-7-r7a-browser-tool-bus.test.ts test/p5-7-r9-t3-memory-persistence-clear-boundary.test.ts test/p5-7-r12-t10-agent-first-router-second.test.ts test/p6-agent-run-core-phase3-context-policy.test.ts test/p6-feishu-message-context-phase2.test.ts` -> `54 pass / 0 fail`
  - `PATH="$HOME/.bun/bin:$PATH" bun test` -> `1573 pass / 0 fail`
  - `npm run test:all` -> 通过

## Links

- Plan: docs/design/plan-260311-release-gate-stale-regression-lock-alignment.md
