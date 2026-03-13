---
id: 0154
title: tool bus 薄网关化
status: done
owner: agent
labels: [tools, runtime, refactor, docs]
risk: medium
scope: 收口 Tool Bus 的 read_file 解释层与重复 guidance
plan_doc: docs/design/plan-260313-tool-bus-thin-gateway.md
links: []
---

## Context

`src/tools/bus.ts` 当前承担了真实工具执行，但 `read_file` 分支仍混入明显的解释层：

- 二进制文件错误包含长段“下一步建议”
- ENOENT / EISDIR / 非普通文件错误带教学文案
- 大文件返回同时写入 `data.guidance` 与 preview `[guidance]`

这些内容不属于“参数校验 -> 执行真实能力 -> 原样返回”的薄网关职责，而是在执行层替模型解释下一步。

## Goal / Non-Goals

- Goal: 删除 Tool Bus 中 `read_file` 的长段教学文案与重复 guidance 字段
- Goal: 保留参数校验、fs_scope、binary / large-file guard 与导航事实
- Goal: 保持 `bash` / `help_docs` / `read_file` 的工具合同与能力边界不变
- Non-Goals: 本轮不改 tool-loop 主链
- Non-Goals: 本轮不重做 manifest 全体系
- Non-Goals: 本轮不把 bus 厚逻辑平移到别的文件

## Plan

- [x] 建立 issue / plan，冻结范围与 Occam 口径
- [x] 清点 Tool Bus 中必须保留的网关职责与可删解释层
- [x] 删除 `read_file` 的 guidance 字段与“下一步建议”错误文案
- [x] 更新 `tools.bus` 与 read_file 直接相关回归测试
- [x] 跑 targeted tests、`npx tsc --noEmit`、`npm run docs:check`
- [x] 更新 Notes、状态与 `docs/CHANGELOG.md`

## Acceptance Criteria

1. `read_file` 不再在 bus 层返回长段“下一步建议”文案
2. `read_file` 大文件成功结果不再包含 `guidance` 重复字段
3. 参数错误、fs_scope、二进制/大文件保护、导航事实仍保留
4. `tools.bus` 与 read_file 相关回归通过

## Notes

- 真相源：
  - `aidocs/reviews/20260313-msgcode-thin-runtime-review-rewrite.md`
  - `issues/0153-tool-loop-heat-path-decontrol.md`
- 初步证据：
  - `src/tools/bus.ts` 中 `buildReadFileBinaryMessage()`、`buildReadFilePreviewText(guidance)` 与 `read_file` 分支错误消息
  - `src/tools/types.ts` 中 `read_file.guidance?`
  - `test/tools.bus.test.ts` 中对 guidance / 下一步建议的断言
- 2026-03-13:
  - 保留的网关职责：
    - 参数校验
    - `fs_scope` 边界
    - 二进制 / 大文件 fail-closed 与 preview 保护
    - `path` / `byteLength` / `truncated` / `fullOutputPath` / `textPath` 等导航事实
    - 基本错误码结构
  - 已删除的解释层：
    - `read_file.data.guidance`
    - `buildReadFilePreviewText()` 中 `[guidance]`
    - 二进制 / ENOENT / EISDIR / 非普通文件中的“下一步建议”长文案
  - 暂未删除但保留原因：
    - `applyPreviewFooter()`：仍承担统一 `durationMs/fullOutputPath` 导航事实补足，不是教学层
    - `buildBashPreviewText()` / `buildHelpDocsPreviewText()`：当前主要返回结构化事实，没有额外下一步教学
  - 验证：
    - `PATH="$HOME/.bun/bin:$PATH" bun test test/tools.bus.test.ts test/p5-7-r3i-fs-scope-policy.test.ts`
    - `npx tsc --noEmit`
    - `npm run docs:check`

## Links

- Plan: /Users/admin/GitProjects/msgcode/docs/design/plan-260313-tool-bus-thin-gateway.md
