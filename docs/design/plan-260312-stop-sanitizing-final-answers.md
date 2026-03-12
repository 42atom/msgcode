# 停止对最终交付答案做系统清洗

## Problem

当前 `tool-loop` 和 `runAgentChat()` 在返回最终答案时仍调用 `sanitizeLmStudioOutput()`。这意味着系统会继续删除 `<think>`、`<tool_call>`/`<invoke>` 协议片段、元叙事与一部分 JSON-ish 文本。即使不再重试、不再改词，系统仍在重写模型最终交付。

## Occam Check

- 不加它，系统具体坏在哪？
  - 用户拿到的不是模型原话，而是被系统再次净化后的版本，主链仍不是“模型输出即交付”。
- 用更少的层能不能解决？
  - 能。只把清洗器从最终返回路径里拿掉，保留它给错误 snippet / 诊断用。
- 这个改动让主链数量变多了还是变少了？
  - 变少了。删掉“模型输出 -> 系统清洗 -> 用户看到”的旁路，回到“模型输出 -> 用户看到”。

## Decision

选定方案：停止在 `tool-loop` 与 `runAgentChat()` 的最终返回路径上调用 `sanitizeLmStudioOutput()`。清洗器本身保留，用于错误消息和低层兼容诊断；但不再参与最终交付。

## Alternatives

### 方案 A：保留现状

- 优点：用户面更“干净”
- 缺点：系统继续替模型改写交付

### 方案 B：仅从最终交付路径移除清洗

- 优点：最小切口，直接恢复模型原样输出
- 缺点：用户会直接看到 `<think>` / 协议残片等真实输出瑕疵

推荐：方案 B

## Plan

1. 更新 [src/agent-backend/tool-loop.ts](/Users/admin/GitProjects/msgcode/src/agent-backend/tool-loop.ts)
   - 最终 `answer` 不再调用 `sanitizeLmStudioOutput()`

2. 更新 [src/agent-backend/chat.ts](/Users/admin/GitProjects/msgcode/src/agent-backend/chat.ts)
   - `runNativeMcpOnce/runNativeOnce/runCompatOnce/runMiniMaxOnce` 不再清洗返回文本

3. 更新测试
   - [test/p5-7-r3g-multi-tool-loop.test.ts](/Users/admin/GitProjects/msgcode/test/p5-7-r3g-multi-tool-loop.test.ts)
   - [test/p5-7-r3l-7-tool-protocol-retry-and-soul-normalize.test.ts](/Users/admin/GitProjects/msgcode/test/p5-7-r3l-7-tool-protocol-retry-and-soul-normalize.test.ts)
   - 视需要补一条 `runAgentChat()` 直答锁

4. 更新 [docs/CHANGELOG.md](/Users/admin/GitProjects/msgcode/docs/CHANGELOG.md)

5. 验证
   - `bun test` 定向回归
   - `npx tsc --noEmit`
   - `npm run docs:check`

## Risks

- 用户会直接看到模型原始 `<think>`、协议残片或元叙事
- 这会暴露模型质量问题，但符合“系统不代替模型修饰交付”的方向

回滚策略：

- 直接回滚 `chat.ts`、`tool-loop.ts`、对应测试、issue/plan 与 changelog

评审意见：[留空,用户将给出反馈]
