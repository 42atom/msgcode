# 移除 tool-loop 对最终答复的内部自动重试

## Problem

当前 `tool-loop` 在工具轮后若发现模型给出空答复或协议残片，会主动补发一轮内部消息，要求模型“直接给出最终答复”。这虽然改善了部分 UX，但本质上是系统悄悄给模型加了一次恢复机会，继续保留了一层看不见的保姆逻辑。

## Occam Check

- 不加它，系统具体坏在哪？
  - 系统继续偷偷追加一轮内部对话，主链不再是“模型当前输出 -> 直接交付”，而是“模型输出 -> 系统判断不满意 -> 再逼一次”。
- 用更少的层能不能解决？
  - 能。直接删除自动重试，让模型当前输出原样成为本轮交付。
- 这个改动让主链数量变多了还是变少了？
  - 变少了。删掉“最终答复重试”这条隐藏旁路，只剩单次工具回灌后的真实输出。

## Decision

选定方案：删除 `needsFinalAnswerRetry()` 与 `buildFinalAnswerRetryMessage()` 以及对应调用。工具轮后，无论模型给的是空字符串还是协议残片，都不再由系统自动补打一轮；用户拿到的就是模型当下真实交付。

## Alternatives

### 方案 A：保留现状

- 优点：对用户更“像样”
- 缺点：系统继续暗中修补模型

### 方案 B：彻底移除内部重试

- 优点：最符合“系统不代做决定”的主线
- 缺点：会显露模型当前真实缺陷，包括空答复和协议残片

推荐：方案 B

## Plan

1. 更新 [src/agent-backend/tool-loop.ts](/Users/admin/GitProjects/msgcode/src/agent-backend/tool-loop.ts)
   - 删除 `needsFinalAnswerRetry()`
   - 删除 `buildFinalAnswerRetryMessage()`
   - 删除 Anthropic/OpenAI 两条主路径中的自动补打一轮逻辑

2. 更新测试
   - [test/p5-7-r3h-tool-failure-diagnostics.test.ts](/Users/admin/GitProjects/msgcode/test/p5-7-r3h-tool-failure-diagnostics.test.ts)
   - [test/p5-7-r3l-7-tool-protocol-retry-and-soul-normalize.test.ts](/Users/admin/GitProjects/msgcode/test/p5-7-r3l-7-tool-protocol-retry-and-soul-normalize.test.ts)
   - 新口径：不再补打一轮，返回当前真实输出

3. 更新 [docs/CHANGELOG.md](/Users/admin/GitProjects/msgcode/docs/CHANGELOG.md)

4. 验证
   - `bun test` 定向回归
   - `npx tsc --noEmit`
   - `npm run docs:check`

## Risks

- 用户将直接看到模型的空答复或协议残片
- 这会暴露模型/提示词问题，但也更忠实于当前主线

回滚策略：

- 直接回滚 `tool-loop.ts`、对应测试、issue/plan 与 changelog

评审意见：[留空,用户将给出反馈]
