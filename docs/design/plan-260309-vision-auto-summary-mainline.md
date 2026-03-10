# Plan: 图片自动摘要主链收口，后续视觉任务交回主模型

Issue: 0053

## Problem

当前图片附件主链做得过宽：自动预处理会偷用用户文本，`vision` 在有 query 时又被系统压成一句话回答，导致主模型很难真正决定后续视觉任务。更糟的是，摘要缓存会污染同图后续详细提取。结果不是模型能力不够，而是系统先替模型把任务裁窄了。

## Occam Check

- 不加这次改动，系统具体坏在哪？
  - 用户发送图片后再追问“提取表格文字”，系统仍倾向沿用摘要口径，主模型拿不到真正自由的视觉后处理主链。
- 用更少的层能不能解决？
  - 可以。删掉自动层对用户任务的干预，保留摘要预览；把后续视觉任务还给主模型即可，不需要新控制层。
- 这个改动让主链数量变多了还是变少了？
  - 变少了。自动层只做摘要，详细处理统一走主模型 + `vision` 单一路径。

## Decision

采用最小收口方案：

1. 自动图片预处理只生成摘要，不再偷用用户文本做视觉任务。
2. `vision` runner 不再内建 `ocr` 分叉；有 query 时直接按任务交给视觉模型。
3. 视觉缓存按“图片 + query”分离，避免摘要污染详细提取。
4. 运行时口径统一为 `vision`，不再在主链暴露 `VisionOcr`。

核心理由：

1. 更符合“系统服务 LLM，不替 LLM 裁决”的原则。
2. 不新增层，只删除过度干预。
3. 自动摘要和后续详细处理边界更清晰。

评审意见：[留空,用户将给出反馈]

## Plan

1. 收口自动图片主链
   - 文件：
     - `src/listener.ts`
     - `src/media/pipeline.ts`
   - 修改：
     - listener 不再把用户文本传给自动图片处理
     - 自动层只调用 `vision(imagePath)` 生成摘要
   - 验收：
     - 代码主链不再出现 `processAttachment(..., text)`

2. 收口 `vision` runner
   - 文件：
     - `src/runners/vision.ts`
     - `src/tools/bus.ts`
   - 修改：
     - 无 query：一行图片摘要
     - 有 query：直接按任务执行，不再压成一句话，不再内建 OCR 分叉
   - 验收：
     - query prompt 中不再出现“一句话说清楚”

3. 修缓存污染
   - 文件：
     - `src/runners/vision.ts`
   - 修改：
     - 摘要沿用 `<digest>.txt`
     - query 结果写成 `<digest>.q-<hash>.txt`
   - 验收：
     - 同图已有摘要时，再带 query 调 `vision` 仍会重新执行

4. 收口运行时命名
   - 文件：
     - `src/media/pipeline.ts`
     - `src/providers/output-normalizer.ts`
     - `src/tools/bus.ts`
     - 相关测试
   - 修改：
     - 自动摘要标签改为 `[图片摘要]`
     - 运行时主链用 `vision`，不再暴露 `VisionOcr`
   - 验收：
     - 主链代码搜索不再出现 `vision_ocr` / `runVisionOcr` / `若要纯抽字请发：ocr`

## Risks

1. 自动摘要命名变化可能影响旧文本兼容
   - 回滚/降级：保留 output normalizer 的宽松图片标签处理
2. query 结果改为单独缓存后，磁盘产物会比以前多
   - 回滚/降级：必要时只保留最近 query 结果，但本轮先不加清理逻辑
3. `npx tsc --noEmit` 当前仓库本身不干净
   - 回滚/降级：本轮以定向测试为准，并显式记录既有类型错误

评审意见：[留空,用户将给出反馈]
