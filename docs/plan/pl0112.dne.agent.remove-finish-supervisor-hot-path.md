# 移除 finish supervisor 的热路径复核请求

## Problem

`finish supervisor` 已经不再阻塞主流程，但它仍会在 tool-loop 收尾阶段额外打一轮 LLM 请求，只为了写一条 `finish-supervisor` journal 与日志。这继续把主链拖成“模型 -> 工具 -> 模型 -> 额外 supervisor 请求 -> 用户”，既增加延迟，也保留了第二层语义。

## Occam Check

- 不加它，系统具体坏在哪？
  - 用户虽然不再被 supervisor 拦截，但每次 mutating/claim 场景仍要多打一轮 LLM 请求；主链延迟、token 和复杂度都还在。
- 用更少的层能不能解决？
  - 能。直接删除 `finish supervisor` 的热路径调用与 journal，只保留现有 `verify` 证据。
- 这个改动让主链数量变多了还是变少了？
  - 变少了。删掉“收尾再找第二个 LLM 复核”的旁路，回到“模型 -> 工具 -> 原始结果 -> 模型 -> 用户”。

## Decision

选定方案：彻底移除 `finish supervisor` 的热路径请求、journal 和相关私有函数。本轮只删这条额外复核旁路，不顺手处理 `config.supervisor` 或 `runVerifyPhase`，避免把“删裁判热路径”和“删所有观测/配置遗留”混成一刀。

## Alternatives

### 方案 A：保留现状

- 优点：继续保留一层额外审计
- 缺点：主链仍然多打一轮请求，继续违背“做薄”

### 方案 B：删除 finish supervisor 热路径，保留 verify

- 优点：最小切口，直接缩短主链
- 缺点：`config.supervisor` 字段暂时变成遗留配置

### 方案 C：连 verify 一起删除

- 优点：更激进
- 缺点：把两个 seam 混在一起，风险和回归面更大

推荐：方案 B

## Plan

1. 更新 [src/agent-backend/tool-loop.ts](/Users/admin/GitProjects/msgcode/src/agent-backend/tool-loop.ts)
   - 删除 `finish supervisor` 的类型、prompt、解析和 journal 私有函数
   - 删除 Anthropic/OpenAI 两条主路径中的 supervisor 调用
   - 保留 `runVerifyPhase()` 当前行为

2. 更新测试
   - [test/p5-7-r20-minimal-finish-supervisor.test.ts](/Users/admin/GitProjects/msgcode/test/p5-7-r20-minimal-finish-supervisor.test.ts)
   - [test/p5-7-r10-minimax-anthropic-provider.test.ts](/Users/admin/GitProjects/msgcode/test/p5-7-r10-minimax-anthropic-provider.test.ts)
   - 锁住：
     - 不再多打一轮 supervisor 请求
     - `actionJournal` 不再出现 `finish-supervisor`
     - mutating / fail 场景只保留 act + verify

3. 更新 [docs/CHANGELOG.md](/Users/admin/GitProjects/msgcode/docs/CHANGELOG.md)

4. 验证
   - `bun test` 定向回归
   - `npx tsc --noEmit`
   - `npm run docs:check`

## Risks

- 现有测试大量锁了旧的 `finish-supervisor` journal 语义，必须一起翻口径
- `config.supervisor` 会暂时成为遗留配置，但这比继续留热路径更可接受

回滚策略：

- 若需要恢复，整体回滚 `tool-loop.ts`、对应测试、issue/plan 和 changelog 本轮改动

评审意见：[留空,用户将给出反馈]
