---
id: 0108
title: 清理 tool-loop 中已失效的 forcedFinalState 支架
status: done
owner: agent
labels: [refactor, architecture]
risk: low
scope: agent-backend/tool-loop 删除已无行为作用的 forcedFinalState / lastFailureState / 相关分支
plan_doc: docs/design/plan-260312-remove-dead-forced-final-state.md
links: []
---

## Context

在 `0104/0105/0106/0107` 连续删除系统代答与二次裁判后，`tool-loop` 里还残留了一套 `forcedFinalState` / `lastFailureState` 支架。现在这两个变量已经没有任何赋值路径，但仍拖着类型定义、分支判断、metadata 选择和 `shouldRunFinishSupervisor()` 参数一起存在，继续制造“系统还有第二出口”的假象。

## Goal / Non-Goals

### Goal

- 删除 `ForcedFinalState` 类型及相关死变量
- 收窄 `shouldRunFinishSupervisor()` 签名，回到真实输入
- 保持现有行为不变，只清理死支架

### Non-Goals

- 本轮不改工具循环配额语义
- 本轮不重做 verify phase
- 本轮不修改 live prompt corpus

## Plan

- [x] 新建 `0108` issue 与对应 plan，冻结本轮范围
- [x] 删除 `tool-loop` 中 `ForcedFinalState` 类型、`forcedFinalState` / `lastFailureState` 变量与相关分支
- [x] 收窄 `shouldRunFinishSupervisor()` 与 metadata 组装逻辑
- [x] 跑定向工具循环回归、类型检查和 docs:check

## Acceptance Criteria

- `tool-loop` 中不再保留未使用的 `ForcedFinalState` 支架
- `shouldRunFinishSupervisor()` 不再接收死参数
- 定向回归与类型检查通过

## Notes

- 已实现：
  - 删除 `ForcedFinalState` 类型
  - 删除两条 tool-loop 中未使用的 `forcedFinalState` / `lastFailureState`
  - supervisor 与 metadata 逻辑回到只基于真实 `executedToolCalls`
- 验证：
  - `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r3g-multi-tool-loop.test.ts test/p5-7-r10-minimax-anthropic-provider.test.ts test/p5-7-r20-minimal-finish-supervisor.test.ts`
  - `npx tsc --noEmit`
  - `npm run docs:check`

## Links

- /Users/admin/GitProjects/msgcode/issues/0103-ai-os-foundation-roadmap.md
- /Users/admin/GitProjects/msgcode/issues/0105-finish-supervisor-observability-only.md
