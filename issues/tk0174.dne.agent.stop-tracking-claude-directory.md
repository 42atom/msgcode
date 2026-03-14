---
id: 0174
title: 停止跟踪 .claude 目录
status: done
owner: agent
labels: [chore, cleanup, repo]
risk: low
scope: 将 .claude 目录改为本地忽略项并移出版本库跟踪
links: []
---

## Context

仓库当前已经忽略 `CLAUDE.md`，但隐藏目录 `.claude/` 还没有进入 `.gitignore`，其中的 `.claude/settings.local.json` 仍被 Git 跟踪。这和“.claude 只作为本地工具配置”的口径不一致。

## Goal / Non-Goals

### Goal

- 将 `.claude/` 加入 `.gitignore`
- 将已被 Git 跟踪的 `.claude/**` 从版本库移除
- 保留本地 `.claude/` 文件继续可用

### Non-Goals

- 不删除本地 `.claude/` 文件
- 不移除 `CLAUDE.md`
- 不修改历史提交

## Plan

- [ ] 更新 `.gitignore`，加入 `.claude/`
- [ ] 用 `git rm --cached` 移除已跟踪的 `.claude/**`
- [ ] 更新 `docs/CHANGELOG.md`
- [ ] 验证 `.claude/**` 不再被 Git 跟踪

## Acceptance Criteria

- `.gitignore` 包含 `.claude/`
- `git ls-files '.claude/**' '.claude/*'` 无输出
- 本地 `.claude/settings.local.json` 仍存在

## Notes

- `CLAUDE.md` 继续保留为仓库协议文件；本轮只处理隐藏目录 `.claude/`。
- 验证：
  - `git ls-files '.claude/**' '.claude/*'`
  - `npm run docs:check`
- 提交：
  - `794d054 chore: stop tracking claude directory`

## Links

- `/Users/admin/GitProjects/msgcode/.gitignore`
