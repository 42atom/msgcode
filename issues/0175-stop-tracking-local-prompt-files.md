---
id: 0175
title: 停止跟踪本地提示词文件
status: doing
owner: agent
labels: [chore, cleanup, repo]
risk: low
scope: 将 CLAUDE.md 与 AGENTS.md 从开源仓库移除，保留本地忽略口径
links: []
---

## Context

`CLAUDE.md` 与 `AGENTS.md` 当前已经被 `.gitignore` 标记为忽略项，但历史上仍被 Git 跟踪，导致它们继续出现在开源仓库里。这会把本地私有提示词和仓库实现混在一起，污染对外代码库表面。

## Goal / Non-Goals

### Goal

- 将 `CLAUDE.md` 与 `AGENTS.md` 从版本库移除
- 保留本地文件继续可用
- 让开源仓库不再携带本地提示词文件

### Non-Goals

- 不删除本地 `CLAUDE.md`
- 不删除本地 `AGENTS.md`
- 不修改历史提交

## Plan

- [ ] 用 `git rm --cached` 将 `CLAUDE.md` 与 `AGENTS.md` 从版本库移除
- [ ] 更新 `docs/CHANGELOG.md`
- [ ] 验证本地文件仍存在、Git 跟踪已清空

## Acceptance Criteria

- `git ls-files 'CLAUDE.md' 'AGENTS.md'` 无输出
- 本地 `CLAUDE.md` 与 `AGENTS.md` 仍存在
- `docs/CHANGELOG.md` 记录本轮开源面清理

## Notes

- 这轮只清版本库跟踪状态，不改变本地私有提示词的使用方式。

## Links

- `/Users/admin/GitProjects/msgcode/.gitignore`
