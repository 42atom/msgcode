---
id: 0101
title: tool-loop 失败结果先回灌模型而非直接终态给用户
status: done
owner: agent
labels: [refactor, feature]
risk: high
scope: agent-backend tool-loop 用户可见失败语义与模型续跑主链
plan_doc: docs/design/plan-260312-tool-loop-failure-feedback-to-model.md
links: []
---

## Context

当前 `tool-loop` 在工具失败时会直接构造 `forcedFinalState`，把 `TOOL_EXEC_FAILED / ENOENT / stderrTail` 直接变成用户最终答案。这样会抢走模型的执行权，导致模型失去继续重试、换工具、改参数、改路径的机会。真实 `SOUL.md` 案例已经证明，这会让系统比模型更早放弃任务。

## Goal / Non-Goals

### Goal

- 工具失败先回灌给模型，不再直接终态暴露给用户
- 保留 action journal / 日志 / verify 证据
- 让模型有机会在单轮内继续尝试完成任务

### Non-Goals

- 本轮不彻底删除 finish supervisor
- 本轮不重写整套 slash 命令体系
- 本轮不重写整个 tool-loop 架构

## Plan

- [x] 收口 `tool-loop` 失败分支：失败结果进入 `tool_result`，不再直接 `forcedFinalState`
- [x] 补测试：锁“失败会回灌模型继续决策”，不再锁“直接把 TOOL_EXEC_FAILED 回给用户”
- [x] 顺手修正同一事故链上的两处输入抢权：绝对路径不再被误判为 slash 命令；已配置 owner 时，非 owner slash 命令静默忽略
- [x] 跑定向测试与类型检查，记录行为变化

## Acceptance Criteria

- 工具失败后，模型仍能收到失败结果并决定下一步
- 用户默认不再直接收到原始 `TOOL_EXEC_FAILED` 结构化文案
- 失败诊断仍可在 actionJournal / verifyResult / 日志中查看

## Notes

- 已实现：
  - `tool-loop` 工具失败现在会像成功结果一样进入 `tool_result`，由模型决定下一步
  - `read_file` 的 `SOUL.md` 纠偏只作用于当前 workspace 根目录误写，不再篡改用户显式给出的其他绝对路径
  - slash 命令识别从 `startsWith("/")` 收口为“`/word` 形态”，绝对路径文本不再被命令层抢走
  - 当配置了 owner 后，非 owner 的 slash 命令会在 listener 入口静默忽略，不再抢占主链也不再回提示
- 验证：
  - `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r3l-7-tool-protocol-retry-and-soul-normalize.test.ts test/p5-7-r3h-tool-failure-diagnostics.test.ts test/p5-7-r3g-multi-tool-loop.test.ts test/p5-7-r10-minimax-anthropic-provider.test.ts test/p5-7-r20-minimal-finish-supervisor.test.ts test/routes.commands.test.ts test/listener.test.ts`
    - `93 pass / 0 fail`
  - `npx tsc --noEmit`
    - 通过
- 后续：
  - `buildToolLoopFallbackAnswer()` 与 `finish supervisor` 仍保留部分系统代答/二次裁判语义，后续应继续按 execution-authority 审查线单独收口

## Links

- /Users/admin/GitProjects/msgcode/AIDOCS/reviews/260312-execution-authority-audit.md
