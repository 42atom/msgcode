# 移除 tool-loop 的 verify 热路径

## Problem

`verify` 的裁判语义已经退出状态机，但 `tool-loop` 收尾阶段仍然会执行 `runVerifyPhase()`，对最后一个工具结果再做一轮系统检查，并把 `verify` journal / `verifyResult` 追加到返回值。这继续让主链变成“工具执行 -> 系统 verify -> 模型结果返回”，而不是直接交付真实 act 结果。

## Occam Check

- 不加它，系统具体坏在哪？
  - 每轮工具链结束后仍有一段系统 verify 热路径；即使它不再改状态，也还在给主链追加额外检查和额外 journal 语义。
- 用更少的层能不能解决？
  - 能。直接删除 `runVerifyPhase()` 和两处调用点，保留真实工具 act 结果即可。
- 这个改动让主链数量变多了还是变少了？
  - 变少了。删掉“工具完成后再做一轮系统检查”的旁路。

## Decision

选定方案：移除 `tool-loop` 的 verify hot path。本轮只删 agent-backend 内部这段额外检查，不碰 task-supervisor 可选 `verifyResult` 类型，避免把“删热路径”和“删公共类型/接口”混成一刀。

## Alternatives

### 方案 A：保留现状

- 优点：少改测试
- 缺点：verify 仍留在 tool-loop 主链里

### 方案 B：删除 tool-loop verify hot path

- 优点：直接缩短主链，和当前“AI 主执行权”方向一致
- 缺点：部分历史测试要翻口径

### 方案 C：顺手删除所有 verify 类型

- 优点：更彻底
- 缺点：会扩大到 task-supervisor / task-types 的接口面，超出本轮边界

推荐：方案 B

## Plan

1. 更新 [src/agent-backend/tool-loop.ts](/Users/admin/GitProjects/msgcode/src/agent-backend/tool-loop.ts)
   - 删除 `runVerifyPhase()` 及其私有类型依赖
   - 删除 Anthropic/OpenAI 两条主路径中的 verify 调用与 verify journal 追加

2. 更新测试
   - [test/p5-7-r3g-multi-tool-loop.test.ts](/Users/admin/GitProjects/msgcode/test/p5-7-r3g-multi-tool-loop.test.ts)
   - [test/p5-7-r3h-tool-failure-diagnostics.test.ts](/Users/admin/GitProjects/msgcode/test/p5-7-r3h-tool-failure-diagnostics.test.ts)
   - [test/p5-7-r3l-7-tool-protocol-retry-and-soul-normalize.test.ts](/Users/admin/GitProjects/msgcode/test/p5-7-r3l-7-tool-protocol-retry-and-soul-normalize.test.ts)
   - [test/p5-7-r20-minimal-finish-supervisor.test.ts](/Users/admin/GitProjects/msgcode/test/p5-7-r20-minimal-finish-supervisor.test.ts)
   - [test/p5-7-r10-minimax-anthropic-provider.test.ts](/Users/admin/GitProjects/msgcode/test/p5-7-r10-minimax-anthropic-provider.test.ts)

3. 更新 [docs/CHANGELOG.md](/Users/admin/GitProjects/msgcode/docs/CHANGELOG.md)

4. 验证
   - `bun test` 定向回归
   - `npx tsc --noEmit`
   - `npm run docs:check`

## Risks

- 一批历史测试把 verify journal 当成 tool-loop 正常语义，需要统一翻口径
- `verifyResult` 类型仍保留，但 tool-loop 不再填它，后续需要接受这一层接口暂时变空

回滚策略：

- 回滚 `tool-loop.ts`、对应测试、issue/plan 和 changelog 本轮改动

评审意见：[留空,用户将给出反馈]
