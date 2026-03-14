---
id: 0173
title: 停止跟踪 .trash 目录内容
status: done
owner: agent
labels: [chore, cleanup, repo]
risk: low
scope: 将已被 Git 跟踪的 .trash 文件从版本库移除，保留本地忽略口径
links: []
---

## Context

仓库已经通过 `.gitignore` 忽略 `.trash/`，但历史上仍有一批 `.trash/**` 文件已经进入 Git 跟踪。这样会让本应只是本地坟场的目录继续出现在仓库历史和 GitHub 树里，和当前“`.trash` 只作本地临时归档”的口径冲突。

## Goal / Non-Goals

### Goal

- 将所有已被 Git 跟踪的 `.trash/**` 文件从版本库移除
- 保留本地 `.trash/` 忽略口径不变
- 让 `.trash/` 彻底回到本地临时归档用途

### Non-Goals

- 不删除本地 `.trash/` 文件
- 不把 `.trash/` 内容迁回现役树
- 不修改历史提交

## Plan

- [ ] 清点已被 Git 跟踪的 `.trash/**` 文件
- [ ] 用 `git rm --cached` 将其从版本库移除，保留本地副本
- [ ] 更新 `docs/CHANGELOG.md`
- [ ] 验证 `git ls-files '.trash/**'` 结果为空

## Acceptance Criteria

- `git ls-files '.trash/**' '.trash/*'` 无输出
- `.gitignore` 继续保留 `.trash/`
- `docs/CHANGELOG.md` 记录本轮仓库清理

## Notes

- 这轮清理只影响版本库跟踪状态，不影响本地 `.trash` 目录继续使用。
- 验证：
  - `git ls-files '.trash/**' '.trash/*'`
  - `npm run docs:check`
- 提交：
  - `6f408bf chore: stop tracking trash directory`

## Links

- `/Users/admin/GitProjects/msgcode/.gitignore`
