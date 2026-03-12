---
id: 0122
title: 恢复 write_file/edit_file 为第一公民并下沉写改预览
status: done
owner: agent
labels: [refactor]
risk: medium
scope: 默认工具面、tool manifest、workspace 默认 allow、tool-loop 提示与写改文件 previewText
plan_doc: docs/design/plan-260312-first-class-file-tools-and-write-preview-layering.md
links: [issues/0119-cli-reference-vs-runtime-gap-review.md, issues/0103-ai-os-foundation-roadmap.md]
---

## Context

Issue 0119 指出当前工具面仍然偏碎。上一轮 `0121` 已把 `help_docs` 接入模型主探索路径并把 quota 热路径结构化，但默认工具面仍保留旧收口策略：

- `write_file/edit_file` 底层实现已存在
- 默认 `tooling.allow` 与 `getToolsForLlm()` 仍把它们藏起来
- 旧测试甚至锁定“用户点名 edit_file 也应改走 bash”

这会把 `bash` 继续变成隐式文件写改总线，削弱第一公民工具的价值，也让输出层在写改成功后只能回灌原始 JSON，而不是执行层 preview。

## Goal / Non-Goals

### Goal

- 恢复 `write_file/edit_file` 为默认第一公民文件工具
- 让模型在默认主链中直接拿到这两种文件写改工具
- 为 `write_file/edit_file` 补执行层 `previewText`

### Non-Goals

- 不删除 `bash`
- 不改 `vision/mem` 的默认暴露策略
- 不把工具面重构成单一 `run(command)`

## Plan

- [x] 移除 `write_file/edit_file` 的默认 suppress
- [x] 将两者加入默认 `tooling.allow` 与用户可见工具列表
- [x] 为 `write_file/edit_file` 增加执行层 previewText
- [x] 更新 tool-loop 原生工具优先提示，明确文件写改优先原生工具而不是 bash
- [x] 更新相关回归测试、0119 Notes 与 CHANGELOG

## Acceptance Criteria

1. 无 workspace 或默认 workspace 下，`getToolsForLlm()` 默认可见 `write_file/edit_file`
2. 自然语言或显式工具偏好场景下，模型不再被系统预设逼回 `bash`
3. `write_file/edit_file` 的成功回灌包含执行层 `previewText`
4. 回归、类型检查与 docs 校验全部通过

## Notes

- 相关文件预计包括：
  - `src/tools/{manifest.ts,bus.ts,types.ts}`
  - `src/config/workspace.ts`
  - `src/routes/cmd-tooling.ts`
  - `src/agent-backend/tool-loop.ts`
  - `test/p5-7-r3l-7-tool-protocol-retry-and-soul-normalize.test.ts`
- 实际验证：
  - `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r3l-7-tool-protocol-retry-and-soul-normalize.test.ts test/p5-7-r8c-llm-tool-manifest-single-source.test.ts test/p5-7-r15-agent-read-skill-bridge.test.ts test/p5-6-8-r4g-pi-core-tools.test.ts test/tools.bus.test.ts test/p5-6-8-r3b-edit-file-patch.test.ts test/p5-7-r6-hotfix-gen-entry-tools-default.test.ts test/p5-6-8-r3d-decoupling-regression.test.ts test/p5-6-8-r3e-hard-cut.test.ts`
  - `107 pass / 0 fail`
  - `npx tsc --noEmit`
  - `npm run docs:check`

## Links

- Plan: [docs/design/plan-260312-first-class-file-tools-and-write-preview-layering.md](/Users/admin/GitProjects/msgcode/docs/design/plan-260312-first-class-file-tools-and-write-preview-layering.md)
