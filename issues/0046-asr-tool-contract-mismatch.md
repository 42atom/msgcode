---
id: 0046
title: 修复 asr 工具合同不一致导致的空路径失败
status: open
owner: agent
labels: [bug, asr, tools]
risk: medium
scope: ASR 工具说明书与 Tool Bus 执行参数不一致
plan_doc: docs/design/plan-260309-asr-tool-contract-mismatch.md
links: []
---

## Context

2026-03-08 17:11:52 的飞书语音消息已经成功进入附件主链，附件也成功复制到了 workspace vault，但后续 `asr` 工具执行失败。

运行时证据：
- 日志文件：`/Users/admin/.config/msgcode/log/msgcode.log`
- 关键片段：
  - `Feishu 入站事件 msgType=audio ... resourceKeyField=file_key`
  - `附件检查: hasAttachments=true`
  - `附件已复制到 vault`
  - `Tool Bus: FAILURE asr`
  - `错误：输入文件不存在:`

代码证据：
- `src/tools/manifest.ts` 中 `asr` 的参数 schema 要求 `audioPath`
- `src/tools/bus.ts` 中 `case "asr"` 读取的是 `args.inputPath`
- `src/runners/asr.ts` 在 `inputPath` 为空时会返回 `输入文件不存在:`

这说明当前不是飞书附件下载失败，也不是 vault 复制失败，而是工具合同在说明书和执行层之间出现了参数名分叉。

## Goal / Non-Goals

### Goal
- 修复 `asr` 工具合同不一致问题
- 让模型按说明书传参时，Tool Bus 能正确调用 `runAsr()`
- 为该问题补回归锁，避免再次出现“说明书写 A，执行层读 B”

### Non-Goals
- 不重构飞书附件主链
- 不改音频自动处理策略
- 不新增新的 ASR 工具或 wrapper

## Plan

- [ ] 对齐 `asr` 工具合同，统一 `audioPath` / `inputPath` 语义
- [ ] 优先保持对现有调用的兼容，避免修复时打断已存在调用方
- [ ] 补 manifest/bus 的合同回归测试
- [ ] 用现有日志中的飞书语音场景做定向验证

## Acceptance Criteria

- `asr` 的说明书字段名和执行层字段名一致
- 模型按 `audioPath` 传参时，`Tool Bus` 不再传空路径给 `runAsr()`
- 同类飞书语音请求不再出现 `错误：输入文件不存在:`
- 有对应测试锁住该合同

## Notes

### Docs
- `src/tools/manifest.ts`

### Code
- `src/tools/bus.ts`
- `src/runners/asr.ts`
- `src/tools/types.ts`

### Logs
- `/Users/admin/.config/msgcode/log/msgcode.log`
  - `2026-03-08 17:11:52` 到 `17:11:59`

## Links

- Plan: `docs/design/plan-260309-asr-tool-contract-mismatch.md`
