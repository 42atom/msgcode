---
id: 0128
title: Tool preview 元数据脚注统一收口
status: done
owner: agent
labels: [refactor, tools]
risk: medium
scope: Tool Bus 执行层 previewText 的统一元数据脚注与去重策略
plan_doc: docs/design/plan-260312-tool-preview-metadata-footer-unification.md
links: [docs/design/plan-260312-cli-is-all-agents-need-reference.md, issues/0119-cli-reference-vs-runtime-gap-review.md]
---

## Context

当前执行层 `previewText` 已经成为 Tool Bus 的单一真相源，但结果合同仍不够稳定：

- `bash` preview 有 `exitCode/fullOutputPath`
- 大部分工具 preview 没有统一 `durationMs`
- 同类工具返回给模型的尾部证据格式不完全一致

这会让模型在多轮执行中拿到的反馈格式忽胖忽瘦，不利于“错误 -> 证据 -> 下一步”的稳定自发现。

## Goal / Non-Goals

### Goal

- 将执行层 preview 的元数据脚注统一收口到 Tool Bus 内部
- 让模型稳定看到 `durationMs`，并在需要时稳定看到 `fullOutputPath`
- 保持 `tool-loop` 继续只转运 `previewText`

### Non-Goals

- 不新增新工具
- 不新增新控制层/恢复层
- 不修改 `tool-loop` 的主决策语义
- 不重写各工具主文本 preview 结构

## Plan

- [x] 新增 Tool Bus 内部的 preview footer helper
- [x] 在 `executeTool()` 返回前统一追加 `durationMs`
- [x] 若存在 `fullOutputPath` 且 preview 未写入，则统一追加
- [x] 保持总长度裁剪仍在执行层完成，不回流到 `tool-loop`
- [x] 补 `tools.bus` 回归测试
- [x] 更新 `docs/CHANGELOG.md`

## Acceptance Criteria

- 至少 `bash/read_file/help_docs/write_file/feishu_send_file` 的 previewText 含稳定 `durationMs`
- `fullOutputPath` 不重复输出
- `tool-loop` 无新增 preview 裁剪逻辑
- 回归测试通过，`tsc` 与 `docs:check` 通过

## Notes

- 这次收口遵循 `0119` 主线，不加新层，只做执行层内部 helper
- 目标是“统一结果合同”，不是“发明新 preview 系统”
- 验证：
  - `PATH="$HOME/.bun/bin:$PATH" bun test test/tools.bus.test.ts test/p5-7-r25-tool-result-context-clip.test.ts test/p5-7-r3h-tool-failure-diagnostics.test.ts`
  - `npx tsc --noEmit`
  - `npm run docs:check`
- 真实通道验收：
  - `AIDOCS/reports/feishu-live-bdd-run-260312-r4-tool-preview-footer.md`

## Links

- [母单 0119](/Users/admin/GitProjects/msgcode/issues/0119-cli-reference-vs-runtime-gap-review.md)
- [参考文档](/Users/admin/GitProjects/msgcode/docs/design/plan-260312-cli-is-all-agents-need-reference.md)
- [Live BDD 报告](/Users/admin/GitProjects/msgcode/AIDOCS/reports/feishu-live-bdd-run-260312-r4-tool-preview-footer.md)
