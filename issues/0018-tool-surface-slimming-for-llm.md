---
id: 0018
title: 收口模型默认工具面到 read_file 与 bash
status: done
owner: agent
labels: [bug, refactor, tooling]
risk: medium
scope: agent-backend/config/routes/prompt/tests
plan_doc: docs/design/plan-260307-tool-surface-slimming-for-llm.md
links:
  - /Users/admin/.config/msgcode/log/msgcode.log
  - f214558
created: 2026-03-07
due:
---

## Context

- 最新真实对话日志显示，模型在文件编辑任务上被 `edit_file` 合同和协议门反复绊倒：
  - `edit_file: 'edits' must be a non-empty array`
  - `MODEL_PROTOCOL_FAILED`
- 即使修了 `edit_file` 简写兼容，默认配置、`/pi on`、`/tool allow` 和 prompt 仍继续把 `write_file/edit_file` 暴露给模型。
- 用户明确要求：工具调用写不好就去掉，文件写改宁可统一走 `bash`。

## Goal / Non-Goals

### Goals

- 让模型默认文件工具面收口为 `read_file + bash`。
- `write_file/edit_file` 不再默认暴露给模型，不再默认加入新工作区配置，也不再继续通过提示词鼓励调用。
- 保留底层实现作为兼容能力，不在本轮删除执行代码。

### Non-Goals

- 本轮不删除 `write_file/edit_file` 的 Tool Bus 执行实现。
- 本轮不切换 browser 底座。
- 本轮不改动非文件类工具的整体策略。

## Plan

- [x] 创建并评审 Plan 文档：`docs/design/plan-260307-tool-surface-slimming-for-llm.md`
- [x] 修改默认配置与 `/pi on` 自动注入列表
- [x] 修改 LLM 暴露层与 prompt，默认不再暴露 `write_file/edit_file`
- [x] 更新 `/tool allow` 可用列表与相关提示
- [x] 调整回归测试并跑定向验证
- [x] 更新 CHANGELOG

## Acceptance Criteria

1. 新工作区默认 `tooling.allow` 不包含 `write_file/edit_file`。
2. 即使旧工作区配置里仍有 `write_file/edit_file`，模型默认暴露层也不再把它们送进 `tools[]`。
3. Prompt 与命令提示不再把 `write_file/edit_file` 作为默认主路径推荐给模型。
4. 定向测试通过。

## Notes

- Logs: `/Users/admin/.config/msgcode/log/msgcode.log`
- 关键日志：
  - `2026-03-07 06:02:07 ... MODEL_PROTOCOL_FAILED`
  - `2026-03-07 06:04:40 ... BROWSER_HTTP_ERROR: create target: context canceled`
  - `2026-03-07 05:55-05:57 ... edit_file: 'edits' must be a non-empty array`
- Tests:
  - `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-6-8-r4g-pi-core-tools.test.ts test/p5-6-8-r3b-edit-file-patch.test.ts test/p5-7-r3l-7-tool-protocol-retry-and-soul-normalize.test.ts test/p5-7-r8c-llm-tool-manifest-single-source.test.ts test/p5-7-r9-t2-skill-global-single-source.test.ts test/tools.bus.test.ts`
  - `76 pass, 0 fail`

## Links

- Plan: `docs/design/plan-260307-tool-surface-slimming-for-llm.md`
