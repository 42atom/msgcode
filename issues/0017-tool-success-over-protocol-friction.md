---
id: 0017
title: 工具调用成功率优先于协议摩擦
status: doing
owner: agent
labels: [bug, refactor, tooling]
risk: medium
scope: agent-backend/tools/manifest/tests
plan_doc: docs/design/plan-260307-tool-success-over-protocol-friction.md
links:
  - docs/notes/research-260307-patchright-phase-a.md
created: 2026-03-07
due:
---

## Context

- 最新日志显示模型在真实对话里多次因为工具协议过硬而失败：
  - `edit_file` manifest 教模型传 `oldText/newText`，执行层却只认 `edits[]`
  - 显式工具偏好在 `edit_file/browser` 场景下把模型锁死，未按预期调用就直接返回 `MODEL_PROTOCOL_FAILED`
- 用户明确指出系统目标应是“让大模型成功调用”，而不是人为设置调用障碍。

## Goal / Non-Goals

### Goals

- 统一 `edit_file` 的 manifest 和执行合同。
- 对文件编辑/浏览器类任务，允许显式工具偏好退回 `bash` 完成。
- 用测试锁住“成功率优先”的新口径。

### Non-Goals

- 本轮不删除 `edit_file` 工具。
- 本轮不重做所有工具协议。
- 本轮不处理 Patchright 正式切换。

## Plan

- [ ] 创建并评审 Plan 文档：`docs/design/plan-260307-tool-success-over-protocol-friction.md`
- [ ] 统一 `edit_file` 参数合同
- [ ] 放宽显式工具偏好，允许 `bash` 后备
- [ ] 补充并跑通回归测试
- [ ] 更新 CHANGELOG

## Acceptance Criteria

1. `edit_file` 支持 `edits[]` 与 `oldText/newText` 简写。
2. `edit_file/write_file/browser` 显式偏好失败时，可退回 `bash`。
3. 相关回归测试通过。

## Notes

- Logs: `/Users/admin/.config/msgcode/log/msgcode.log`
- 关键日志：
  - `edit_file: 'edits' must be a non-empty array`
  - `MODEL_PROTOCOL_FAILED`

## Links

- Plan: `docs/design/plan-260307-tool-success-over-protocol-friction.md`
