---
id: 0178
title: AIDOCS 分层整理为 active 与 archive
status: doing
owner: agent
labels: [docs, cleanup, repo]
risk: low
scope: 整理 AIDOCS/reviews 与 AIDOCS/reports 的现役输入和历史档案边界
plan_doc: docs/design/plan-260313-aidocs-active-archive-layering.md
links: []
---

## Context

`AIDOCS/` 目前混合了现役 review 输入、一次性 live 验收报告、旧阶段设计草稿和历史沉淀。目录结构已经无法直接表达“哪些文档还在指导当前决策、哪些只是历史档案”。

证据：

- `AIDOCS/reviews` 当前 `tracked=5`，`total_files=15`
- `AIDOCS/reports` 当前 `tracked=13`，`total_files=19`
- 部分文件无外部引用，例如：
  - `AIDOCS/reports/feishu-live-bdd-run-260312-r2.md`
  - `AIDOCS/reports/msgcode核心链路设计调研报告.md`
  - `AIDOCS/reports/omlx-latency-benchmark-260311.md`

## Goal / Non-Goals

### Goal

- 为 `AIDOCS/reviews` 与 `AIDOCS/reports` 建立 `active/archive` 分层
- 归档一批明显过时、低引用或一次性的文档
- 新增索引说明，让后续新增文档不再继续堆在根层

### Non-Goals

- 不大规模搬运整个 `AIDOCS/`
- 不移动仍被 issue/plan 大量引用的 tracked review
- 不处理 `AIDOCS/msgcode-2.*` 这种历史产品资料分支

## Plan

- [ ] 新增 `AIDOCS/README.md` 和分层说明
- [ ] 创建 `AIDOCS/reviews/active`、`AIDOCS/reviews/archive/20260313`
- [ ] 创建 `AIDOCS/reports/active`、`AIDOCS/reports/archive/20260313`
- [ ] 移动一批明显过时或无外部引用的文档
- [ ] 更新被移动文件的必要引用
- [ ] 更新 `docs/CHANGELOG.md`

## Acceptance Criteria

- `AIDOCS/reviews` 与 `AIDOCS/reports` 存在明确的 `active/archive` 分层
- 至少一批明显过时文档已归档
- `AIDOCS/README.md` 明确当前目录使用规则
- `npm run docs:check` 通过

## Notes

- 第一刀优先移动“无外部引用”与“仅一轮性草稿”的文档，避免误伤当前真相源。

## Links

- docs/design/plan-260313-aidocs-active-archive-layering.md
