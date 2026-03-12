---
id: 0109
title: 移除 tool-loop 对 SOUL 路径的静默改参
status: done
owner: agent
labels: [refactor, architecture]
risk: medium
scope: agent-backend/tool-loop 不再把 read_file 的 SOUL 路径偷偷改写到 .msgcode/SOUL.md
plan_doc: docs/design/plan-260312-remove-soul-path-mutation.md
links: []
---

## Context

`tool-loop` 当前仍保留 `normalizeSoulPathArgs()`：当模型对 `read_file` 传入 `SOUL.md`、`./SOUL.md` 或 `<workspace>/SOUL.md` 时，系统会静默改写成 `.msgcode/SOUL.md`。这虽然提升了某些 case 的容错，但本质上还是系统替模型纠偏参数，违背了当前“把真实错误忠实回给模型，不抢执行权”的主线。

## Goal / Non-Goals

### Goal

- 删除 `normalizeSoulPathArgs()` 及其调用
- 让错误路径按原始工具语义失败，并把真实结果回灌给模型
- 更新回归锁，避免继续依赖 silent mutation

### Non-Goals

- 本轮不动 `needsFinalAnswerRetry`
- 本轮不动 `runVerifyPhase`
- 本轮不重写 `SOUL` 文件读取工具

## Plan

- [x] 新建 `0109` issue 与对应 plan，冻结边界
- [x] 删除 `tool-loop` 中 `normalizeSoulPathArgs()` 及其两处调用
- [x] 更新 `p5-7-r3l-7` 回归锁，改为验证“错误路径保留原生失败并回灌模型”
- [x] 跑定向测试、类型检查和 docs:check

## Acceptance Criteria

- `tool-loop` 不再静默改写 `read_file` 的 SOUL 路径
- 错路径会按工具原生语义失败
- 模型仍可基于失败 `tool_result` 自己给出后续答复

## Notes

- 已实现：
  - 删除 `normalizeSoulPathArgs()` 及其两处调用
  - `read_file` 的错误 `SOUL.md` 路径不再被系统暗改
  - `p5-7-r3l-7` 回归锁已翻成“原生失败回灌模型”口径
- 验证：
  - `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r3l-7-tool-protocol-retry-and-soul-normalize.test.ts test/p5-7-r3g-multi-tool-loop.test.ts test/p5-7-r3h-tool-failure-diagnostics.test.ts`
  - `npx tsc --noEmit`
  - `npm run docs:check`

## Links

- /Users/admin/GitProjects/msgcode/issues/0102-llm-execution-authority-charter.md
- /Users/admin/GitProjects/msgcode/issues/0103-ai-os-foundation-roadmap.md
