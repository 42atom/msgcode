---
id: 0172
title: GitHub 展示面统一到 v2.4.0 与 ghost 主链
status: done
owner: agent
labels: [docs, chore, github]
risk: low
scope: README 与 GitHub workflow 的现役口径收口到 v2.4.0 和 ghost
plan_doc: docs/design/plan-260313-github-surface-align-to-v2-4-0.md
links: []
---

## Context

仓库内部版本口径已经升级到 `2.4.0`，但 GitHub 首页与 workflow 仍残留旧 Desktop Bridge 的心智。特别是 `.github/workflows/desktop-smoke.yml` 还引用已经归档的 `mac/` 与 `scripts/desktop/`，会继续向外界暗示 legacy desktop 是现役主链。

## Goal / Non-Goals

### Goal

- 让 GitHub 首页 README 明确当前版本与当前桌面主链
- 让 GitHub Actions 不再展示失真的 legacy desktop workflow
- 保持 GitHub 侧说明与仓库现役主链一致

### Non-Goals

- 不直接发布 GitHub Release
- 不改历史 release 文档
- 不恢复或重写 legacy desktop workflow

## Plan

- [ ] 更新 README 的 GitHub 首屏口径
- [ ] 退役 `.github/workflows/desktop-smoke.yml`
- [ ] 更新 changelog 记录 GitHub 展示面收口
- [ ] 运行 `npm run docs:check`

## Acceptance Criteria

- README 首屏明确 `v2.4.0` 与 `ghost_*` 现役桌面能力面
- `.github/workflows/desktop-smoke.yml` 不再留在现役 workflow 目录
- `docs/CHANGELOG.md` 记录本轮 GitHub 口径收口

## Notes

- GitHub Release 发布/打 tag 如需执行，单独做，不与本轮 README/workflow 收口混做
- 验证：
  - `npm run docs:check`
- 提交：
  - `b9428dd docs: align github surface with ghost mainline`

## Links

- docs/design/plan-260313-github-surface-align-to-v2-4-0.md
