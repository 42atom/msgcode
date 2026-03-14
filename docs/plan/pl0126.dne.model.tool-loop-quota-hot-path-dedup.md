# 收口 tool-loop 配额热路径重复逻辑

## Problem

`tool-loop` 在 OpenAI 与 MiniMax 两条热路径中，都各自内联了多段“超过 `tool calls / tool steps` 配额后返回 continuable quota result”的重复逻辑。这让主链阅读成本高，也让 quota 行为的后续收口更难做。

## Occam Check

- 不加这次改动，系统具体坏在哪？
  - quota 行为会继续散落在两条热路径里，任何后续微调都要双改双验，容易造成实现漂移。
- 用更少的层能不能解决？
  - 能。只提炼成 `tool-loop` 文件内部的纯 helper，不新增模块、不新增策略层。
- 这个改动让主链数量变多了还是变少了？
  - 变少了。OpenAI/MiniMax 两条热路径共享同一套 quota continuable 构造逻辑。

## Decision

选定方案：在 `src/agent-backend/tool-loop.ts` 内新增两段纯 helper：

1. `maybeBuildToolCallQuotaResult(...)`
2. `maybeBuildToolStepQuotaResult(...)`

同时把硬上限常量提升为文件级真相源。

核心理由：

1. quota continuable 目前是纯重复逻辑，适合就地收口
2. helper 只做结构化返回构造，不引入新状态或新策略
3. 这一步能继续缩短热路径，为后续进一步瘦身保留空间

## Plan

1. 修改 `/Users/admin/GitProjects/msgcode/src/agent-backend/tool-loop.ts`
   - 提升 `HARD_CAP_TOOL_CALLS / HARD_CAP_TOOL_STEPS`
   - 新增 `maybeBuildToolCallQuotaResult`
   - 新增 `maybeBuildToolStepQuotaResult`
   - 用 helper 替换 OpenAI 与 MiniMax 路径中的重复 quota continuable 构造
2. 运行验证
   - `bun test test/p5-7-r3g-multi-tool-loop.test.ts test/p5-7-r3h-tool-failure-diagnostics.test.ts test/p5-7-r12-t8-tool-loop-quota-strategy.test.ts test/p5-7-r12-t9-mainline-quota-continuation-smoke.test.ts`
   - `npx tsc --noEmit`
   - `npm run docs:check`

## Risks

- 风险：helper 参数映射错误会造成 `remainingToolCalls / continuationReason` 漂移
  - 应对：只做机械去重，保持原字符串和字段值完全一致，并跑 quota 专项回归

回滚/降级策略：

- 这轮是纯重构，若发现 quota 语义漂移，可直接回滚该 commit

评审意见：[留空,用户将给出反馈]
