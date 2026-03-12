---
id: 0110
title: 移除 tool-loop 对最终答复的内部自动重试
status: done
owner: agent
labels: [refactor, architecture]
risk: high
scope: agent-backend/tool-loop 不再因空答复或协议残片而偷偷补打一轮内部对话
plan_doc: docs/design/plan-260312-remove-final-answer-auto-retry.md
links: []
---

## Context

`tool-loop` 当前仍保留 `needsFinalAnswerRetry()` 与 `buildFinalAnswerRetryMessage()`：当工具轮后模型给出空答复或协议残片，系统会再发一轮内部请求，逼模型“只给最终答复”。这属于典型的隐藏恢复层，仍在替模型修补交付。

## Goal / Non-Goals

### Goal

- 删除 `needsFinalAnswerRetry()` / `buildFinalAnswerRetryMessage()`
- 让工具轮后的最终答复直接采用模型当下真实输出
- 更新回归锁，明确不再发生内部自动重试

### Non-Goals

- 本轮不动 `runVerifyPhase`
- 本轮不动 `finish supervisor`
- 本轮不尝试用新的替代层填补空答复

## Plan

- [x] 新建 `0110` issue 与对应 plan，冻结边界
- [x] 删除 `tool-loop` 中最终答复自动重试逻辑
- [x] 更新 `p5-7-r3h`、`p5-7-r3l-7` 回归锁，改为验证“不再内部补打一轮”
- [x] 跑定向测试、类型检查和 docs:check

## Acceptance Criteria

- `tool-loop` 不再因空答复或协议残片而自动补打一轮
- 回归测试改为锁真实当前输出，而不是锁系统代修复
- 相关验证通过

## Notes

- 已实现：
  - 删除 `needsFinalAnswerRetry()` / `buildFinalAnswerRetryMessage()`
  - Anthropic/OpenAI 两条 tool-loop 主路径都不再偷偷补打一轮
  - 回归锁已翻成“直接交付模型当下真实输出”口径
- 验证：
  - `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r3h-tool-failure-diagnostics.test.ts test/p5-7-r3l-7-tool-protocol-retry-and-soul-normalize.test.ts test/p5-7-r3g-multi-tool-loop.test.ts`
  - `npx tsc --noEmit`
  - `npm run docs:check`

## Links

- /Users/admin/GitProjects/msgcode/issues/0102-llm-execution-authority-charter.md
- /Users/admin/GitProjects/msgcode/issues/0103-ai-os-foundation-roadmap.md
