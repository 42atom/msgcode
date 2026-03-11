---
id: 0082
title: 归档 IndexTTS 遗留并清理合并前工作树
status: done
owner: agent
labels: [refactor, docs, chore, test]
risk: medium
scope: 将 IndexTTS 遗留代码/文档移出正式真相源，清理本轮相关工作树，为后续合并主链做准备
plan_doc: docs/design/plan-260311-indextts-archive-cleanup-and-merge-prep.md
links: []
---

## Context

在 `Qwen-only TTS` 主链落地后，仓库里仍残留三类 IndexTTS 遗留：

- 正式真相源里还保留旧合同
  - `src/deps/manifest.json`
  - `src/deps/preflight.ts`
  - `src/media/model-paths.ts`
- `src/` 下仍有未使用的 IndexTTS 代码文件
  - `src/runners/tts/backends/indexts.ts`
  - `src/runners/tts/backends/indexts-worker.ts`
  - `src/runners/tts/emotion.ts`
- 历史文档和临时垃圾仍散落在工作树
  - 例如 `AIDOCS/msgcode-2.2/indextts_optimization_memo.md`
  - 例如根目录误入的空文件 `indextts`

用户要求：

- 继续清理 legacy IndexTTS 文件和旧文档
- 放入归档，而不是直接丢失
- 清理工作树，准备后续合并分支回主链

## Goal / Non-Goals

- Goal: 将 IndexTTS 代码遗留移出 `src/` 正式真相源
- Goal: 将 IndexTTS 专项文档移入归档区
- Goal: 清掉本轮相关垃圾文件与无用残留
- Goal: 让合并前工作树只剩与其他任务相关的改动
- Non-Goals: 不在本轮处理无关的 OMLX / local-backend 未提交改动
- Non-Goals: 不重做整个 TTS 模块
- Non-Goals: 不追求一次性清掉所有历史文档里的提及

## Plan

- [x] 新建 issue / plan，冻结归档与清理范围
- [x] 收口正式真相源中的 IndexTTS 依赖合同
- [x] 将未使用的 IndexTTS 代码移入 `.trash/` 归档
- [x] 将 IndexTTS 专项文档移入 `docs/archive/`
- [x] 更新测试、changelog，并提交单独 commit
- [x] 复核剩余工作树，只保留与其他任务相关的改动

## Acceptance Criteria

1. `src/` 正式主链不再包含可达的 IndexTTS 代码入口
2. `src/deps/manifest.json` 不再列出 IndexTTS 依赖
3. `src/deps/preflight.ts` 与 `src/media/model-paths.ts` 不再维护 IndexTTS 正式合同
4. IndexTTS 专项代码与文档可在归档区追溯
5. 本轮提交后，工作树中的残留变更不再包含 IndexTTS 这条线

## Notes

- 归档原则：
  - 代码文件优先移动到 `.trash/<date>-indextts-legacy-runtime/`
  - 历史文档进入 `docs/archive/`
- 合并前清理只处理“本轮相关”残留；不擅自回退其他脏改动
- 本轮归档：
  - `src/runners/tts/backends/indexts.ts`
  - `src/runners/tts/backends/indexts-worker.ts`
  - `src/runners/tts/emotion.ts`
  - `docs/archive/indextts_optimization_memo_v2.2.md`
- 正式真相源已同步删口径：
  - `src/deps/manifest.json`
  - `src/deps/preflight.ts`
  - `src/media/model-paths.ts`
- Tests:
  - `npm test -- test/p5-6-13-r2a-tts-qwen-contract.test.ts test/p5-7-r24-backend-command-lanes.test.ts test/p5-7-r31-qwen-only-tts-mainline.test.ts test/p5-7-r9-t6-model-path-hardcode-purge.test.ts test/p5-7-r26-local-model-load-retry.test.ts test/p5-7-r6c-preflight-env-fallback.test.ts`

## Links

- Plan: docs/design/plan-260311-indextts-archive-cleanup-and-merge-prep.md
