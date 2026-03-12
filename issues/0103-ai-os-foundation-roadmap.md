---
id: 0103
title: AI 基础操作系统主线路线图
status: open
owner: agent
labels: [architecture, roadmap, refactor]
risk: high
scope: 将 msgcode 收口为 AI-first 基建层，并为未来 app/web client 与自生长能力提供稳定主线
plan_doc: docs/design/plan-260312-ai-os-foundation-roadmap.md
links: []
---

## Context

用户已明确把 `msgcode` 定义为“AI 基础操作系统”，而不是聊天应用或代理平台。仓库最近已冻结 `AI 主执行权` 宪章，但还缺一份母级路线图，说明未来如何把现有实现继续收口成：薄内核、真实工具、说明书型 skill、强可观测性、可自扩展、可长 app/web client 的基础设施。

## Goal / Non-Goals

### Goal

- 冻结 `msgcode` 作为 AI-first 基建层的长期主线
- 明确后续实施顺序：先删裁判层，再做能力第一公民，再补自生长闭环
- 让后续 issue/plan 都能对齐到统一母单，避免分支漂移

### Non-Goals

- 本轮不直接改运行时代码
- 本轮不设计具体 app/web client 产品
- 本轮不新建控制面、调度平台或“agent OS”子系统

## Plan

- [ ] 冻结“基建三层 + 生长两环”结构模型，作为后续实现母框架
- [ ] 定义 Phase 1：继续删除抢执行权的残余层
- [ ] 定义 Phase 2：把 CLI/工具收口为第一公民能力边界
- [ ] 定义 Phase 3：把 skill 彻底收口为说明书体系
- [ ] 定义 Phase 4：补强真实验证循环与重资源 admission
- [ ] 定义 Phase 5：为未来 app/web client 冻结更薄的 channel seam

## Acceptance Criteria

- 仓库中存在一份正式 plan，明确 `msgcode` 的基建定位、阶段划分、依赖顺序和非目标
- 路线图能清楚回答：先做什么、后做什么、哪些事不要做
- 后续相关 issue 能被这份母单吸纳或引用，而不是继续各自为政

## Notes

- 本轮只冻结路线，不开始实现

## Links

- /Users/admin/GitProjects/msgcode/issues/0102-llm-execution-authority-charter.md
- /Users/admin/GitProjects/msgcode/issues/0101-tool-loop-failure-feedback-to-model.md
- /Users/admin/GitProjects/msgcode/issues/0097-runtime-skill-wrapper-slimming.md
- /Users/admin/GitProjects/msgcode/issues/0098-feishu-live-verification-loop.md
- /Users/admin/GitProjects/msgcode/issues/0099-skill-live-prompt-corpus-v1.md
- /Users/admin/GitProjects/msgcode/issues/0094-heavy-resource-admission-mvp.md
