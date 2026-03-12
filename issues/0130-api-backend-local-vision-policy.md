---
id: 0130
title: API backend 下视觉能力冻结为本地模型
status: done
owner: agent
labels: [refactor, vision, privacy]
risk: medium
scope: 收口 /vision-model 与 /model status 口径，使 api backend 下视觉能力明确走本地模型
plan_doc: docs/design/plan-260312-api-backend-local-vision-policy.md
links: [issues/0080-backend-command-lanes-v1.md]
---

## Context

当前代码里：

- `runVision()` 只走本地视觉链
- `model.api.vision` 只是配置槽位，未被运行时消费
- `/vision-model` 和 `/model status` 在 `backend=api` 时仍表现得像存在独立 `api vision`

这会制造错误心智：用户以为图片会走云端 API，实际却仍在本地执行。

## Goal / Non-Goals

### Goal

- 明确冻结：`vision` 是 local-only 能力
- `backend=api` 时，`/vision-model` 仍读写本地视觉模型配置
- `backend=api` 时，`/model status` 明确显示 `vision-model: local-only (...)`

### Non-Goals

- 本轮不删除 `model.api.vision` 历史字段
- 本轮不新增云端 vision adapter
- 本轮不改本地视觉执行链

## Plan

- [x] 新建 issue / plan，冻结 “api text + local vision” 口径
- [x] 调整 `/model status`，在 `backend=api` 时回显 local-only vision
- [x] 调整 `/vision-model`，在 `backend=api` 时仍落到 local lane
- [x] 更新回归测试
- [x] 更新 CHANGELOG

## Acceptance Criteria

1. `runVision()` 继续只读 local vision 配置
2. `backend=api` 时 `/vision-model xxx` 会更新 `model.local.vision`
3. `backend=api` 时 `/model status` 显示 `vision-model: local-only (<id|auto>)`
4. 不新增新的控制层或 provider 分支

## Notes

- 这轮先收口“说真话”，不做历史字段清仓
- 验证：
  - `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r24-backend-command-lanes.test.ts test/routes.commands.test.ts test/p5-7-r6b-default-model-preference.test.ts`
  - `npx tsc --noEmit`
  - `npm run docs:check`

## Links

- [Issue 0080](/Users/admin/GitProjects/msgcode/issues/0080-backend-command-lanes-v1.md)
