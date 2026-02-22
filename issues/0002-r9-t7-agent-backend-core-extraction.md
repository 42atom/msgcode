---
id: 0002
title: R9-T7 agent-backend 核心拆分与 lmstudio 兼容壳化
status: doing
owner: opus
labels: [refactor, backend, architecture]
risk: high
scope: agent-backend 主链拆分与 lmstudio 兼容层降级（不改变外部行为合同）
plan_doc: docs/design/plan-260223-r9-t7-agent-backend-core-extraction.md
links:
  - docs/tasks/p5-7-r9-t7-agent-backend-core-extraction.md
---

## Context

`R9-T6` 已完成命名与语义收敛，但 `src/lmstudio.ts` 仍是高耦合 God Object，承载配置、提示词、tool loop、路由编排和兼容导出。该结构会持续放大后端切换和工具链改造回归风险。

## Goal / Non-Goals

- Goal: 把业务实现迁出 `src/lmstudio.ts` 到 `src/agent-backend/*`，并保留稳定兼容层。
- Goal: 用行为锁防止新代码回流依赖 `runLmStudio*`。
- Non-Goals: 不改变 tool loop 协议、不调整温度锁策略、不引入新后端能力。

## Plan

- [ ] 建立 `src/agent-backend/` 核心模块骨架与类型出口。
- [ ] 迁移配置解析与 prompt builder 到核心模块，保持行为等价。
- [ ] 迁移 tool loop 与 routed chat 到核心模块，并将 `lmstudio.ts` 降级为兼容壳。
- [ ] 增加兼容层与 no-backflow 回归锁，替换脆弱源码字符串断言。
- [ ] 同步任务文档与兼容说明，完成三门验收。

## Acceptance Criteria

1. `src/lmstudio.ts` 仅保留兼容导出与说明，主逻辑迁至 `src/agent-backend/*`。
2. `runAgentRoutedChat` / `runAgentToolLoop` 行为合同保持不变（温度锁、路由锁、actionJournal 锁）。
3. `npx tsc --noEmit`、`npm test`、`npm run docs:check` 全通过。

## Notes

- 执行分支：`codex/p5-7-r3e-hotfix-2`（后续按主线收敛策略执行）。
- 强约束：禁止跨单叠改，发现 tool loop 回归立即停线修复。
- 派单：已指派 Opus 执行（R9-T7-1 开始）。

## Links

Issue: `0002`
- Plan: `docs/design/plan-260223-r9-t7-agent-backend-core-extraction.md`
- Task: `docs/tasks/p5-7-r9-t7-agent-backend-core-extraction.md`
