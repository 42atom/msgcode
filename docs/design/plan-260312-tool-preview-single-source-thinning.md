# 收口 tool preview 单一真相源并移除 tool-loop 二次裁剪

## Problem

当前 tool result 的输出层仍有残余双真相源：

- `bash/read_file/write_file/edit_file/help_docs` 已在 Tool Bus 生成 `previewText`
- 但其他正式工具还没有统一 preview
- `tool-loop` 仍保留 `serializeToolResultForConversation()` 的 JSON 裁剪兜底
- `context-policy` 里还挂着只给 tool-loop 用的 `clipToolPreviewText()`

这让执行层和呈现层仍然没有完全断开。只要有一批工具没有 preview，tool-loop 就会继续回头加工结果。

## Occam Check

- 不加它，系统具体坏在哪？
  - tool result 的呈现仍会在 Tool Bus 和 tool-loop 两处漂移；新增工具时也会继续重复“先返回 data，再在热路径里临时裁剪 JSON”。
- 用更少的层能不能解决？
  - 能。不是加 presenter，而是把 preview 统一补到 Tool Bus，然后让 tool-loop 只转运执行层产物。
- 这个改动让主链数量变多了还是变少了？
  - 变少了。tool result 呈现从“两层加工”收口成“执行层产出、热路径转运”。

## Decision

选定方案：继续把 preview 真相源收口到 Tool Bus。为当前正式工具补齐 `previewText`，并让 `tool-loop` 退出 `clipToolPreviewText()` 这条二次裁剪热路径。

关键理由：

1. preview 本来就属于执行结果的一部分，应该跟工具一起产出
2. `tool-loop` 的职责是编排和转运，不该再兼做“通用 JSON 摘要器”
3. 这样能让后续新工具只补一处合同，而不是每次都去碰热路径

## Plan

1. 补齐执行层 preview
   - `src/tools/bus.ts`：为 `tts/asr/vision/browser/desktop/feishu_*` 增加统一 `previewText`
   - 通用 catch 路径也返回最小失败 preview
2. 收口热路径
   - `src/agent-backend/tool-loop.ts`：去掉对 `clipToolPreviewText()` 的依赖
   - 只保留 `previewText` 优先和最小字符串兜底
3. 删除悬挂 helper
   - `src/runtime/context-policy.ts`：删除不再被主链使用的 `clipToolPreviewText()`
4. 验证
   - `test/tools.bus.test.ts`
   - `test/p5-7-r3g-multi-tool-loop.test.ts`
   - `test/p5-7-r3h-tool-failure-diagnostics.test.ts`

## Risks

1. preview 文案变更可能导致少量快照/字符串测试翻红
   - 回滚：恢复旧 preview helper 和 tool-loop JSON 裁剪
2. 某些工具的 preview 过长或信息不足
   - 回滚：只调整对应工具的 preview builder，不回滚主链收口

## Test Plan

- `bun test test/tools.bus.test.ts test/p5-7-r3g-multi-tool-loop.test.ts test/p5-7-r3h-tool-failure-diagnostics.test.ts`
- 如涉及新工具路径，再补对应专项测试
- `npx tsc --noEmit`
- `npm run docs:check`

## Observability

- Tool Bus 继续输出统一结构化日志
- preview contract 变化通过 tests + actionJournal 行为验证

（章节级）评审意见：[留空,用户将给出反馈]
