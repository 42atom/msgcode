---
id: 0168
title: 将 legacy desktop bridge 整包迁入版本化 archive
status: done
owner: agent
labels: [refactor, docs, chore]
risk: medium
scope: mac/docs-desktop/scripts-desktop/recipes-desktop 退出现役树并迁入 archive
plan_doc: docs/design/plan-260313-archive-legacy-desktop-bridge.md
links:
  - issues/0167-mac-legacy-surface-freeze.md
  - docs/design/plan-260310-ghost-os-desktop-plugin-replacement.md
---

## Context

`ghost_*` 已经是唯一现役桌面能力面。上一刀只把 `mac/` 与 `docs/desktop/` 打成 legacy 口径，但源码、脚本、recipe 和历史协议仍然挂在现役树上，继续让仓库结构显得像“双桌面主链”。如果目标是让仓库干净简单，就应该把整套 legacy desktop bridge 从现役目录树挪到版本化 archive。

## Goal / Non-Goals

- Goal: 将 `mac/`、`docs/desktop/`、`scripts/desktop/`、`recipes/desktop/` 迁入 `docs/archive/retired-desktop-bridge/`。
- Goal: 更新现役导航与入口，避免继续暴露 legacy package script。
- Goal: 保留完整历史资料，可追溯、可 grep、可手动恢复。
- Non-Goals: 不物理删除任何 legacy desktop 资料。
- Non-Goals: 不改 `ghost_*` 主链、Tool Bus、tool-loop。
- Non-Goals: 不重写历史 release notes 的叙事，只修现役入口与主要导航。

## Plan

- [x] 建 issue / plan，冻结“整包归档”的范围。
- [x] 迁移 `mac/`、`docs/desktop/`、`scripts/desktop/`、`recipes/desktop/` 到版本化 archive。
- [x] 更新根 README / docs 导航 / archive 索引 / package 入口。
- [x] 补 `.gitignore`，避免 archive 中的 legacy build 输出污染工作树。
- [x] 更新 `docs/CHANGELOG.md` 并跑 `npm run docs:check`。

## Acceptance Criteria

1. 根目录与现役 `docs/` / `scripts/` / `recipes/` 不再保留 legacy desktop bridge 目录。
2. `docs/archive/retired-desktop-bridge/` 中保留完整 legacy 资料。
3. `package.json` 不再暴露 legacy desktop smoke 入口。
4. `npm run docs:check` 通过。

## Notes

- Docs: `docs/design/plan-260313-archive-legacy-desktop-bridge.md`
- Archived:
  - `docs/archive/retired-desktop-bridge/mac/`
  - `docs/archive/retired-desktop-bridge/docs/desktop/`
  - `docs/archive/retired-desktop-bridge/scripts/desktop/`
  - `docs/archive/retired-desktop-bridge/recipes/desktop/`
  - `docs/archive/retired-desktop-bridge/RELEASING.md`
- Active surface cleanup:
  - `package.json` 已移除 legacy desktop smoke 入口
  - `README.md` / `docs/README.md` / `docs/archive/README.md` 已改指向 archive
- Verification:
  - `npm run docs:check`

## Links

- Plan: `docs/design/plan-260313-archive-legacy-desktop-bridge.md`
