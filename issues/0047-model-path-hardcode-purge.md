---
id: 0047
title: 模型路径去硬编码专项修复
status: done
owner: agent
labels: [refactor, tts, asr, path]
risk: medium
scope: src/media, src/probe, src/deps, src/runners, prompts
---

## Context

当前 TTS/ASR 路径决策存在多处硬编码开发机路径：

1. **qwen.ts**: `/Users/admin/GitProjects/GithubDown/qwen3-tts-apple-silicon` 作为 fallback (L31-32)
2. **tts probe**: `/Users/admin/GitProjects/GithubDown/qwen3-tts-apple-silicon` 作为 fallback (L57)
3. **preflight.ts**: 同上 (L40, L113)
4. **asr.ts**: `~/Models/whisper-large-v3-mlx` 默认值 (L95)
5. **prompt**: `/Users/admin/.config/msgcode/...` 硬编码 (agents-prompt.md L5,7,9,11)
6. **pipeline.ts**: ASR 硬编码 (L181)

问题：不同模块对同一后端得到不同默认路径，且开发机路径泄漏到运行时。

## Goal / Non-Goals

### Goal
1. 新增共享路径解析模块 `src/media/model-paths.ts`
2. 统一收口 TTS (Qwen/IndexTTS) 和 ASR (Whisper) 路径解析逻辑
3. 清理 prompt 中的用户目录硬编码，改为运行时注入
4. 确保 probe/preflight/backend 对同一后端得到一致的默认路径语义
5. 确保 prompt 注入复用配置主链 (MSGCODE_CONFIG_DIR)

### Non-Goals
1. 不做自动下载模型
2. 不做模型注册中心、PathManager
3. 不改 browser、skills、workspace 等无关路径系统
4. 不保留 GitProjects/GithubDown 兜底

## Plan

- [x] 1. 创建 `src/media/model-paths.ts` 共享模块
- [x] 2. 改造 `src/runners/tts/backends/qwen.ts` 使用 shared resolver
- [x] 3. 改造 `src/probe/probes/tts.ts` 使用 shared resolver
- [x] 4. 改造 `src/deps/preflight.ts` 使用 shared resolver
- [x] 5. 改造 `src/runners/asr.ts` 接入路径解析
- [x] 6. 改造 `src/media/pipeline.ts` 接入路径解析
- [x] 7. 清理 `prompts/agents-prompt.md` 硬编码
- [x] 8. 修复 prompt 注入复用配置主链
- [x] 9. 添加行为测试
- [x] 10. 验证路径语义一致性

## Acceptance Criteria

1. 运行时代码里不再用 `/Users/admin/...` 参与 TTS/ASR 路径决策
2. probe、preflight、backend 对同一后端得到同一套默认路径语义
3. 未配置时必须明确 warning/error，不允许静默猜开发机目录
4. prompt 模板中不再写死 `/Users/admin/.config/msgcode/...`，但运行时渲染结果仍是绝对路径
5. prompt 注入复用 MSGCODE_CONFIG_DIR 配置主链
6. pipeline.ts 与 runAsr 使用一致的 ASR 路径语义
7. 新增或修改的测试通过

## Notes

### 证据
- Code: `src/runners/tts/backends/qwen.ts` L31-32 硬编码 - 已移除
- Code: `src/probe/probes/tts.ts` L57 硬编码 - 已移除
- Code: `src/deps/preflight.ts` L40, L113 硬编码 - 已移除
- Code: `src/runners/asr.ts` L90-95 默认路径 - 已接入 shared resolver
- Code: `src/media/pipeline.ts` L181 硬编码 - 已接入 shared resolver
- Code: `prompts/agents-prompt.md` L5,7,9,11 硬编码 - 已改为占位符
- Code: `src/agent-backend/prompt.ts` 注入逻辑 - 已复用 MSGCODE_CONFIG_DIR 主链

### 测试结果
- TTS 相关测试: 5 pass, 0 fail
- 模型路径行为锁测试: 11 pass, 0 fail
