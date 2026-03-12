---
id: 0112
title: 移除 finish supervisor 的热路径复核请求
status: done
owner: agent
labels: [refactor, architecture]
risk: high
scope: agent-backend tool-loop 删除 finish supervisor 的额外 LLM 热路径请求
plan_doc: docs/design/plan-260312-remove-finish-supervisor-hot-path.md
links: []
---

## Context

`finish supervisor` 虽然已经失去阻塞/续跑裁判权，但它仍在 tool-loop 收尾阶段额外打一轮 LLM 请求，只为了写一条 `finish-supervisor` 日志和 journal。这仍然让主链变成“模型 -> 工具 -> 模型 -> supervisor 请求 -> 用户”，平白增加延迟、token 和第二层语义。

## Goal / Non-Goals

### Goal

- 删除 `finish supervisor` 在热路径上的额外 LLM 请求
- 删除 `finish-supervisor` action journal 与相关日志
- 保留 `runVerifyPhase` 当前证据语义，本轮不把验证逻辑一起混删

### Non-Goals

- 本轮不删除 `config.supervisor` 配置字段
- 本轮不改 `runVerifyPhase` 的 verify 证据结构
- 本轮不处理其他安全 / 预算边界

## Plan

- [x] 新建 `0112` issue 与对应 plan，冻结边界
- [x] 删除 `tool-loop` 中 `finish supervisor` 的私有函数、类型和两处调用点
- [x] 更新 `p5-7-r20` 与 `p5-7-r10` 回归锁，改成“不再额外复核”
- [x] 更新 `docs/CHANGELOG.md`
- [x] 跑定向测试、类型检查和 docs:check

## Acceptance Criteria

- `tool-loop` 收尾阶段不再额外发起 `finish supervisor` LLM 请求
- `actionJournal` 中不再出现 `finish-supervisor`
- mutating / fail / verify 场景仅保留工具原生 `act` / `verify` 证据

## Notes

- 已实现：
  - `tool-loop` 已删除 `finish supervisor` 的 prompt / 解析 / journal 私有函数与两处热路径调用点
  - `actionJournal` 不再写入 `finish-supervisor`
  - `p5-7-r20`、`p5-7-r10` 已翻成“只保留 act + verify 证据，不再额外复核”
- 验证：
  - `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r20-minimal-finish-supervisor.test.ts test/p5-7-r10-minimax-anthropic-provider.test.ts test/p5-7-r3h-tool-failure-diagnostics.test.ts test/p5-7-r3g-multi-tool-loop.test.ts`
    - `27 pass / 0 fail`
  - `npx tsc --noEmit`
    - `EXIT:0`
  - `npm run docs:check`
    - `✓ 文档同步检查通过`

## Links

- /Users/admin/GitProjects/msgcode/issues/0105-finish-supervisor-observability-only.md
- /Users/admin/GitProjects/msgcode/issues/0103-ai-os-foundation-roadmap.md
