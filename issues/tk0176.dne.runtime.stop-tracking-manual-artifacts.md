---
id: 0176
title: 停止跟踪人工检查 artifacts
status: done
owner: agent
labels: [chore, cleanup, repo]
risk: low
scope: 将 artifacts/manual-modal-check 从版本库移除并改为本地忽略
links: []
---

## Context

`artifacts/manual-modal-check/*.json` 是人工检查与诊断时留下的运行时产物，不属于开源仓库现役代码或正式文档。继续跟踪这类文件会污染仓库主树。

## Goal / Non-Goals

### Goal

- 将 `artifacts/manual-modal-check/` 加入忽略
- 将已被 Git 跟踪的人工检查 artifact 从版本库移除
- 保留本地文件继续作为排障证据使用

### Non-Goals

- 不删除本地 artifact 文件
- 不处理其它 `AIDOCS/**` 或正式文档

## Plan

- [ ] 更新 `.gitignore`
- [ ] 将 `artifacts/manual-modal-check/*.json` 从版本库移除
- [ ] 更新 `docs/CHANGELOG.md`
- [ ] 验证 Git 跟踪已清空且本地文件仍在

## Acceptance Criteria

- `git ls-files 'artifacts/manual-modal-check/**'` 无输出
- 本地 `artifacts/manual-modal-check/*.json` 仍存在
- `docs/CHANGELOG.md` 记录本轮清理

## Notes

- 这轮只清版本库跟踪状态，不影响本地人工排障继续使用这些 artifact。
- 验证：
  - `git ls-files 'artifacts/manual-modal-check/**'`
  - `npm run docs:check`
- 提交：
  - `cbbc605 chore: stop tracking manual artifacts`
  - `e92ac0b chore: remove tracked manual artifact files`

## Links

- `/Users/admin/GitProjects/msgcode/.gitignore`
