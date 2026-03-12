---
id: 0126
title: 收口 tool-loop 配额热路径重复逻辑
status: done
owner: agent
labels: [refactor]
risk: low
scope: tool-loop quota continuable helper、OpenAI/MiniMax 热路径去重
plan_doc: docs/design/plan-260312-tool-loop-quota-hot-path-dedup.md
links: [issues/0119-cli-reference-vs-runtime-gap-review.md]
---

## Context

`tool-loop` 里关于单轮 `tool calls / tool steps` 配额触顶后的 continuable 返回，当前在 OpenAI 与 MiniMax 两条执行路径中各自写了一遍，而且每条路径内部还分散成多段近似代码。这会让热路径继续变厚，也让 quota 行为更难核对。

## Goal / Non-Goals

### Goal

- 把 `tool calls / tool steps` 配额触顶后的 continuable 构造收口成共享 helper
- 把硬上限常量提升为 `tool-loop` 文件级真相源
- 保持现有 quota 行为、返回结构、日志语义不变

### Non-Goals

- 不调整 quota 档位数值
- 不改变 continuable / heartbeat 语义
- 不新增新的 quota 层、恢复层或策略层

## Plan

- [x] 创建 0126 issue / plan
- [x] 在 `src/agent-backend/tool-loop.ts` 提升硬上限常量并新增 quota helper
- [x] 用共享 helper 替换 OpenAI/MiniMax 两条热路径中的重复 quota 构造
- [x] 运行 quota 相关回归、`tsc`、`docs:check`

## Acceptance Criteria

- `tool-loop` 中 `tool calls / tool steps` 触顶后的 continuable 返回只保留一套共享构造逻辑
- OpenAI 与 MiniMax 路径返回的 `continuationReason / quotaSignal / remaining*` 与改动前一致
- 相关 quota 回归测试、`tsc`、`docs:check` 全绿

## Notes

- 这是 `0119` 骨架收口里的纯去重动作，不改对外行为。
- 验证：
  - `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r3g-multi-tool-loop.test.ts test/p5-7-r3h-tool-failure-diagnostics.test.ts test/p5-7-r12-t8-tool-loop-quota-strategy.test.ts test/p5-7-r12-t9-mainline-quota-continuation-smoke.test.ts`
  - `npx tsc --noEmit`
  - `npm run docs:check`

## Links

- [CLI 参考与主链差距审查](/Users/admin/GitProjects/msgcode/issues/0119-cli-reference-vs-runtime-gap-review.md)
