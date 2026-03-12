---
id: 0123
title: 收口 tool preview 单一真相源并移除 tool-loop 二次裁剪
status: done
owner: agent
labels: [refactor]
risk: medium
scope: Tool Bus previewText、tool-loop tool_result 序列化、context-policy 裁剪 helper
plan_doc: docs/design/plan-260312-tool-preview-single-source-thinning.md
links: [issues/0119-cli-reference-vs-runtime-gap-review.md, issues/0120-read-file-contract-and-preview-layering.md, issues/0122-first-class-file-tools-and-write-preview-layering.md]
---

## Context

Issue 0119 明确指出当前输出层仍然没有彻底分层。上一轮 `0120` 已经把 `bash/read_file` 的 preview 收到执行层，`0122` 又补了 `write_file/edit_file`。但当前主链仍残留两条旧世界逻辑：

- `tts/asr/vision/browser/desktop/feishu_*` 等工具缺少统一 `previewText`
- `tool-loop` 仍在 `serializeToolResultForConversation()` 里兜底把原始 JSON 再裁一次

这意味着执行层还不是 tool result 的唯一真相源，`context-policy` 里的 `clipToolPreviewText()` 也继续承担了本不该留在主链里的第二道裁剪职责。

## Goal / Non-Goals

### Goal

- 为当前正式工具补齐稳定 `previewText`
- 让 `tool-loop` 优先只转发执行层 `previewText`
- 让 `clipToolPreviewText()` 退出主链

### Non-Goals

- 不重写 `ToolResult` 数据字段
- 不新增新的渲染层或 presenter
- 不改 quota / scheduler / listener 主链

## Plan

- [x] 为缺失 preview 的正式工具补齐执行层 `previewText`
- [x] 将 `tool-loop` 的 tool_result 序列化收口为“优先 previewText，兜底最小 raw string”
- [x] 删除 `context-policy` 中只服务 tool-loop 的 preview helper
- [x] 补回归测试锁定“preview 真相源在 Tool Bus，不在 tool-loop”
- [x] 更新 0119 / CHANGELOG

## Acceptance Criteria

1. 当前正式工具成功/失败结果都能提供稳定 `previewText`
2. `tool-loop` 不再依赖 `clipToolPreviewText()` 处理 tool_result
3. 回归、类型检查、docs 校验通过

## Notes

- 重点文件：
  - `src/tools/bus.ts`
  - `src/tools/types.ts`
  - `src/agent-backend/tool-loop.ts`
  - `src/runtime/context-policy.ts`
  - `test/tools.bus.test.ts`
- 已收口结果：
  - `tts/asr/vision/browser/desktop/feishu_*` 均由 Tool Bus 生成稳定 `previewText`
  - gate / 参数校验 / 通用 catch 失败路径也统一返回执行层 `previewText`
  - `tool-loop` 不再依赖 `clipToolPreviewText()` 或 `TOOL_RESULT_CONTEXT_MAX_CHARS`
  - `context-policy` 不再导出 tool preview helper
- 验证：
  - `PATH="$HOME/.bun/bin:$PATH" bun test test/tools.bus.test.ts test/p5-7-r3g-multi-tool-loop.test.ts test/p5-7-r3h-tool-failure-diagnostics.test.ts test/p5-7-r25-tool-result-context-clip.test.ts test/p5-7-r12-feishu-send-file.test.ts test/p5-7-r32-feishu-list-members.test.ts test/p6-feishu-message-context-phase4-actions.test.ts test/p5-7-r9-t2-context-budget-compact.test.ts test/p6-agent-run-core-phase3-context-policy.test.ts`
  - `npx tsc --noEmit`
  - `npm run docs:check`

## Links

- Plan: [docs/design/plan-260312-tool-preview-single-source-thinning.md](/Users/admin/GitProjects/msgcode/docs/design/plan-260312-tool-preview-single-source-thinning.md)
