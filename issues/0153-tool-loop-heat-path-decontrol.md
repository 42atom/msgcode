---
id: 0153
title: tool-loop 热路径去代决层
status: done
owner: agent
labels: [agent-backend, runtime, refactor, docs]
risk: medium
scope: 收口 tool-loop 热路径中的恢复提示与系统代决分支
plan_doc: docs/design/plan-260313-tool-loop-heat-path-decontrol.md
links: []
---

## Context

`src/agent-backend/tool-loop.ts` 目前主链已经收口到“模型 -> 工具 -> 结果 -> 模型”附近，但热路径里仍残留一层系统代决：

- 工具失败后，若模型先复述原始错误，系统会注入 synthetic user nudge 再追打一轮
- 两条 provider loop（OpenAI / MiniMax）各自维护这套恢复提示逻辑
- quota 触顶已经是结构化事实返回，但 hot path 仍混入“替模型决定下一步”的旧残留

这层逻辑不增加能力边界，只是在工具失败后替模型做主判断和补救。

## Goal / Non-Goals

- Goal: 删除 tool failure recovery nudge 与相关 hardcoded guidance
- Goal: 保持工具失败默认回到模型上下文，不新增系统补救层
- Goal: 保持 quota / continuable / quotaSignal 的结构化事实合同
- Non-Goals: 本轮不重构 `src/tools/bus.ts`
- Non-Goals: 本轮不改变 TaskSupervisor 的 checkpoint / summary 语义
- Non-Goals: 本轮不新增 supervisor / controller / manager

## Plan

- [x] 建立 issue / plan，冻结范围与 Occam 口径
- [x] 删除 `tool-loop.ts` 中 recovery nudge helper 与两处调用分支
- [x] 确认 quota 结构化返回仍保持单一 helper，不引入新层
- [x] 更新 OpenAI / MiniMax 失败诊断回归测试到“无系统补打一轮”口径
- [x] 跑 tool-loop 相关 targeted tests、`npx tsc --noEmit`、`npm run docs:check`
- [x] 更新 Notes、状态与外部变更记录

## Acceptance Criteria

1. `tool-loop` 热路径不再存在 tool failure recovery nudge 机制
2. 工具失败后若模型输出文本结果，系统不再注入 synthetic user prompt 再追打一轮
3. quota 命中继续返回 `continuable + quotaSignal + continuationReason` 结构化事实
4. OpenAI / MiniMax 相关回归测试明确锁定“无恢复提示补打一轮”

## Notes

- 真相源：
  - `aidocs/reviews/20260313-msgcode-thin-runtime-review-rewrite.md`
  - `issues/0121-help-tool-and-quota-hot-path-thinning.md`
  - `issues/0126-tool-loop-quota-hot-path-dedup.md`
- 证据定位：
  - `src/agent-backend/tool-loop.ts`
  - `test/p5-7-r3h-tool-failure-diagnostics.test.ts`
  - `test/p5-7-r10-minimax-anthropic-provider.test.ts`
- 2026-03-13:
  - 已删除的代决层：
    - `MAX_FAILURE_RECOVERY_NUDGES`
    - `RAW_TOOL_FAILURE_PATTERNS`
    - `looksLikeRawToolFailureAnswer()`
    - `buildToolFailureRecoveryNudge()`
    - `shouldRequestFailureRecovery()`
    - OpenAI / MiniMax 两处 tool failure 后 synthetic user 注入分支
  - 保留的硬边界：
    - `continuable`、`continuationReason`
    - `quotaSignal`
    - `buildContinuableQuotaResult()` 及 quota helper
    - 真实 `tool_result` 回灌模型链路
  - 本轮未改：
    - `src/agent-backend/types.ts`
    - `src/runtime/task-supervisor.ts`
  - 验证：
    - `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r3g-multi-tool-loop.test.ts test/p5-7-r3h-tool-failure-diagnostics.test.ts test/p5-7-r10-minimax-anthropic-provider.test.ts test/p5-7-r12-t8-tool-loop-quota-strategy.test.ts test/p5-7-r12-t9-mainline-quota-continuation-smoke.test.ts`
    - `npx tsc --noEmit`
    - `npm run docs:check`

## Links

- Plan: /Users/admin/GitProjects/msgcode/docs/design/plan-260313-tool-loop-heat-path-decontrol.md
