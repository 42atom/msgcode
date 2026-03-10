---
id: 0053
title: 收口图片自动摘要主链，移除 OCR 型系统裁决
status: done
owner: agent
labels: [bug, refactor, vision]
risk: medium
scope: listener/media pipeline/vision runner/runtime wording
plan_doc: docs/design/plan-260309-vision-auto-summary-mainline.md
links: []
---

## Context

- 当前图片附件主链会在系统层过早替模型做视觉任务裁决：
  - 自动预处理会把用户文本直接塞给 `vision`
  - `vision` 在有 query 时默认压成“一句话回答”
  - 同一张图的摘要缓存会污染后续详细提取
- 实际效果是：系统把图片任务过早收窄成“摘要器”，阻碍主模型自行决定是否继续调用 `vision` 做更细处理。

## Goal / Non-Goals

- Goal: 自动图片主链只做摘要预览，不偷用用户任务做预处理。
- Goal: 后续视觉任务由主模型自行决定是否调用 `vision`。
- Goal: 移除运行时里的 `VisionOcr/OCR 模式` 心智，统一为 `vision`。
- Goal: 修复摘要缓存污染后续 query 的问题。
- Non-Goals: 不新增新的视觉控制层。
- Non-Goals: 不顺手重构整套附件系统或模型选择逻辑。

## Plan

- [x] 创建 Plan 文档，冻结最小收口方案
- [x] listener 不再把用户文本传入自动图片预处理
- [x] 自动图片预处理只保留图片摘要
- [x] `vision` runner 改为“无 query 摘要，有 query 按任务执行”，不再内建 OCR 分叉
- [x] 结果缓存改为按“图片 + query”分离，避免摘要污染后续任务
- [x] 运行时口径从 `vision_ocr` 收口为 `vision`
- [x] 补回归测试并验证

## Acceptance Criteria

1. 收到图片时，系统自动产出的仅是摘要预览，不替主模型决定后续视觉任务。
2. 主模型后续调用 `vision` 时，不再被系统压成一句话回答。
3. 同一张图的摘要结果不会污染后续详细提取。
4. 运行时主链不再暴露 `VisionOcr` / `ocr` 选项口径。

## Notes

- Code:
  - `src/listener.ts`
  - `src/media/pipeline.ts`
  - `src/runners/vision.ts`
  - `src/tools/bus.ts`
  - `src/tools/manifest.ts`
- Tests:
  - `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r13-attachment-routing.test.ts test/p5-7-r23-vision-mainline.test.ts test/p5-7-r6b-default-model-preference.test.ts test/skills.auto.test.ts`
  - `13 pass / 0 fail`
- Follow-up:
  - 2026-03-09 追加修正：`vision` 工具说明书此前只暴露 `imagePath`，真实运行中主模型可能继续只传图片路径，导致详细提取请求仍回落到摘要路径。
  - 已补齐 `userQuery` 参数合同，并补最小运行时日志（`hasUserQuery/cacheKind/cachePath`），便于确认后续是否真实命中 `.q-*` 产物路径。
- TypeScript:
  - `npx tsc --noEmit` 当前仍失败，但失败集中在既有 `feishu/transport.ts`、`jobs/runner.ts`、`cmd-model.ts`、`cmd-schedule.ts`，不是本轮引入。

## Links

- /Users/admin/GitProjects/msgcode/docs/design/plan-260309-vision-auto-summary-mainline.md
