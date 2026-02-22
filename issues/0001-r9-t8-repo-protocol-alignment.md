---
id: 0001
title: R9-T8 仓库文档协议对齐（CLAUDE 规范落地）
status: done
owner: agent
labels: [docs, refactor]
risk: medium
scope: 文档结构协议（issues/design/notes/adr/changelog/docs-check）对齐
plan_doc: docs/design/plan-260223-r9-t8-repo-protocol-alignment.md
links:
  - docs/tasks/p5-7-r9-t8-repo-protocol-alignment.md
---

## Context

当前仓库主文档集中在 `docs/tasks`，但 `CLAUDE.md` 要求的协议目录（`issues/`、`docs/design/`、`docs/notes/`、`docs/adr/`、`docs/CHANGELOG.md`）尚未落地，导致“规范存在但无法执行校验”。

## Goal / Non-Goals

- Goal: 建立 CLAUDE 协议目录、模板、校验与索引兼容层。
- Non-Goals: 不重写历史任务内容，不做大规模文档迁移。

## Plan

- [x] 创建协议目录与模板文件（issues/design/notes/adr）。
- [x] 迁移 changelog 到 `docs/CHANGELOG.md`，保留根路径兼容并新增归档说明。
- [x] 增强 `scripts/check-doc-sync.ts`，增加协议结构检查。
- [x] 更新 `docs/README.md` 与索引文档，补迁移映射说明。
- [x] 运行 `npm run docs:check` 验收并更新状态。

## Acceptance Criteria

1. 协议目录与模板文件存在且可读。
2. `docs/CHANGELOG.md` 为主变更日志路径，旧路径保留兼容提示。
3. `npm run docs:check` 能校验基础协议结构并通过。

## Notes

- `npm run docs:check`：通过（`✓ 文档同步检查通过`）
- `npx tsc --noEmit`：通过
- 兼容迁移：根 `CHANGELOG.md` 已保留 stub 指向 `docs/CHANGELOG.md`
- R9-T8b：`docs:check` 已增加 `issue -> plan -> task` 互链校验（front matter/回链/命名）。

## Links

Issue: `0001`
- Plan: `docs/design/plan-260223-r9-t8-repo-protocol-alignment.md`
- Task: `docs/tasks/p5-7-r9-t8-repo-protocol-alignment.md`
