---
id: 0171
title: 发布版本统一升级到 2.4.0
status: doing
owner: agent
labels: [release, docs, chore]
risk: low
scope: package 版本、release 文档与对外版本口径统一到 2.4.0
plan_doc: docs/design/plan-260313-release-version-bump-to-2-4-0.md
links: []
---

## Context

当前现役包版本仍是 `2.3.0`，`docs/release/` 也还停留在 `v2.3.0.md`。同时仓库里保留了历史 `v1.0.x` 发布文档，容易让“当前版本”和“历史里程碑”混在一起。

## Goal / Non-Goals

### Goal

- 将当前现役版本统一升级为 `2.4.0`
- 补齐 `docs/release/v2.4.0.md`
- 更新 release 索引与 changelog
- 保持历史 `v1.0.x` 发布文档为历史记录，不篡改

### Non-Goals

- 不重写历史发布文案
- 不修改 archive 中的历史版本号
- 不改 probe schema 的 `version: "1.0"` 这类内部报告格式字段

## Plan

- [ ] 更新 `package.json` 与 `package-lock.json` 版本到 `2.4.0`
- [ ] 更新现役运行时版本口径（`ghost-mcp-client`）
- [ ] 新增 `docs/release/v2.4.0.md`
- [ ] 更新 `docs/release/README.md` 与 `docs/CHANGELOG.md`
- [ ] 更新少量现役文档中的当前版本引用
- [ ] 运行 `npx tsc --noEmit` 与 `npm run docs:check`

## Acceptance Criteria

- `package.json` / `package-lock.json` 顶层版本为 `2.4.0`
- `docs/release/` 出现 `v2.4.0.md`
- `docs/release/README.md` 将 `v2.4.0.md` 列为当前 release 文档
- `docs/CHANGELOG.md` 新增 `2.4.0` 条目与 release 链接
- 历史 `v1.0.x` 发布文档保持不变

## Notes

- 版本升级口径：统一当前发布面，不重写历史里程碑

## Links

- docs/design/plan-260313-release-version-bump-to-2-4-0.md
