# 清理 tool-loop 中已失效的 forcedFinalState 支架

## Problem

`tool-loop` 里仍保留 `ForcedFinalState`、`forcedFinalState` 和 `lastFailureState` 这套结构。但在最近几轮收口后，这些变量已经没有任何赋值路径，实际行为始终走 `executedToolCalls -> cleanedAnswer -> verify/supervisor` 这条主线。继续保留它们，只会让代码看起来像还有一条系统强制收尾旁路。

## Occam Check

- 不加它，系统具体坏在哪？
  - 代码继续保留一套不存在的“系统强制终态”支架，误导后续维护者，以为主链还有第二出口。
- 用更少的层能不能解决？
  - 能。直接删除死类型、死变量和相关参数，不新增任何新层。
- 这个改动让主链数量变多了还是变少了？
  - 变少了。代码表达重新和真实运行路径一致，只剩一条 tool-loop 收尾主线。

## Decision

选定方案：删除 `ForcedFinalState` 相关死代码，只保留真实执行路径。`shouldRunFinishSupervisor()` 只根据 `executedToolCalls` 和 `finalAnswer` 决定是否记录观测，不再接收虚假的“强制终态”输入。

关键理由：

1. 这是纯删层，不增加任何新抽象
2. 能让代码结构重新忠实反映当前运行时
3. 为后续继续收口 tool-loop 降低噪音

## Alternatives

### 方案 A：保留死支架

- 优点：零改动
- 缺点：继续制造假主线

### 方案 B：删除死支架

- 优点：最小、最干净、最符合当前主线
- 缺点：无实质功能缺点

推荐：方案 B

## Plan

1. 更新 [src/agent-backend/tool-loop.ts](/Users/admin/GitProjects/msgcode/src/agent-backend/tool-loop.ts)
   - 删除 `ForcedFinalState` 类型
   - 删除两条 loop 里的 `forcedFinalState` / `lastFailureState`
   - 删除 `if (forcedFinalState)` 分支
   - 收窄 `shouldRunFinishSupervisor()` 参数
   - 简化 `firstCall` 元数据组装

2. 验证
   - `bun test` 定向回归
   - `npx tsc --noEmit`
   - `npm run docs:check`

## Risks

- 风险很低，主要是删错分支导致返回结构变化

回滚策略：

- 直接回滚 `tool-loop.ts` 与对应 issue/plan 文档

评审意见：[留空,用户将给出反馈]
