---
id: 0081
title: 收口 TTS 主链为 Qwen-only
status: done
owner: agent
labels: [refactor, feature, docs, test]
risk: medium
scope: 移除 indextts 在命令面、运行时与诊断主链中的正式角色，收口为 Qwen-only TTS
plan_doc: docs/design/plan-260311-qwen-only-tts-mainline.md
links: []
---

## Context

用户确认当前本地 TTS 主链不再需要 `indextts`：

- `qwen` 实测更稳
- `indextts` 对 macOS / Apple Silicon 不够友好
- 当前继续保留双后端 + fallback 只会增加命令面、`/mode`、probe 与配置诊断的歧义

当前真实问题是：

- `/tts-model` 仍暴露 `indextts`
- `runTts()` 仍保留 `qwen -> indextts` fallback
- `/mode` 仍回显 `strict/fallback` 双后端语义
- TTS probe 仍把 IndexTTS 当成正式主链去检查

## Goal / Non-Goals

- Goal: 将 TTS 主链收口为 Qwen-only
- Goal: `/tts-model` 只允许 `qwen | auto`
- Goal: `/mode` 与 doctor/probe 只反映 Qwen 主链
- Goal: 保留遗留 IndexTTS 文件为历史残留，但不再暴露为当前正式能力
- Non-Goals: 不在本轮物理删除所有 IndexTTS 文件
- Non-Goals: 不重做 TTS 架构
- Non-Goals: 不新增新的 TTS provider

## Plan

- [x] 新建 issue / plan，冻结 Qwen-only 口径
- [x] 收口 `src/runners/tts.ts` 为单后端主链
- [x] 收口 `/mode`、`/tts-model`、帮助文案与协议文档
- [x] 收口 TTS probe，不再把 IndexTTS 当正式主链诊断
- [x] 更新测试、changelog，并做单独 commit

## Acceptance Criteria

1. `runTts()` 不再回退到 `indextts`
2. `/tts-model` 只接受 `qwen | auto`
3. `/mode` 只回显 `strict:qwen` 或 `auto:qwen`
4. TTS probe 不再要求 IndexTTS 环境完整
5. 现有 Qwen TTS 合同测试与命令协议测试保持通过

## Notes

- 用户决策：`indextts` 先弃用，Qwen 是正式主链
- 最小可删版本：不做全仓删除，只移出主链与用户可见协议
- 兼容收口：
  - 旧 `TTS_BACKEND=indextts` 会被忽略，主链回到 `auto:qwen`
  - 旧 workspace 中残留的 `model.<lane>.tts=indextts` 会按 `auto` 处理，不再继续回显为正式选项
- Tests:
  - `npm test -- test/routes.commands.test.ts test/p5-7-r8c-agent-backend-single-source.test.ts test/p5-7-r24-backend-command-lanes.test.ts test/p5-7-r9-t7-step4-compatibility-lock.test.ts test/p5-7-r9-t2-runtime-capabilities.test.ts test/p5-7-r23-vision-mainline.test.ts test/p5-7-r3e-model-alias-guard.test.ts test/p5-6-13-r2a-tts-qwen-contract.test.ts test/p5-7-r31-qwen-only-tts-mainline.test.ts`

## Links

- Plan: docs/design/plan-260311-qwen-only-tts-mainline.md
