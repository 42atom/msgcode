# 将 finish supervisor 降为纯观测器

## Problem

即使删除了 `fallback answer`，`finish supervisor` 仍然是 tool-loop 结束前的第二裁判：它能要求 `CONTINUE`、能连续三次后阻塞完成，还能把模型已经给出的答复拉回去重跑。这意味着主链依旧不是“模型 -> 工具 -> 结果 -> 模型 -> 用户”，而是“模型 -> 工具 -> 模型 -> supervisor -> 模型/阻塞”。

## Occam Check

- 不加它，系统具体坏在哪？
  - 用户仍会看到 `FINISH_SUPERVISOR_BLOCKED` 一类系统裁决结果；模型即使已经完成任务，仍可能被第二裁判拦下或拖回重跑。
- 用更少的层能不能解决？
  - 能。保留 supervisor 的日志与审计能力，但删除它影响控制流的权力。
- 这个改动让主链数量变多了还是变少了？
  - 变少了。删掉“supervisor 要求继续/阻塞完成”这条旁路，只留下模型主链和一个不干预的观测点。

## Decision

选定方案：将 `finish supervisor` 降为 **observability-only**。它仍可在收尾时复核并把 `PASS/CONTINUE` 写入 action journal 与日志，但无论结果如何，都不得再改变最终控制流。

关键理由：

1. 保留诊断价值，同时删除抢执行权行为
2. 不需要新增任何新层，只是削掉现有层的裁判权
3. 与 `AI 主执行权` 宪章和 Phase 1“删剩余裁判层”完全一致

## Alternatives

### 方案 A：保留现有 supervisor 裁判权

- 优点：已有实现和测试
- 缺点：继续与主线哲学正面冲突

### 方案 B：完全删除 supervisor

- 优点：最干净
- 缺点：一下失去现有诊断证据面，风险更大

### 方案 C：保留日志/审计，删除裁判权

- 优点：最小可删，直接命中问题
- 缺点：需要改一批以“会拦截/会阻塞”为前提的回归测试

推荐：方案 C

## Plan

1. 更新 [src/agent-backend/tool-loop.ts](/Users/admin/GitProjects/msgcode/src/agent-backend/tool-loop.ts)
   - 删除 `supervisorContinueCount` 与 `maxContinues` 控制流
   - 删除 `buildFinishSupervisorContinuationMessage()` / `buildFinishSupervisorBlockedAnswer()`
   - 保留 `runFinishSupervisorReview()`、日志、journal entry
   - 若 supervisor 返回 `CONTINUE`，只记录，不改写 `finalAnswer`、不追加新消息、不中断完成

2. 调整测试
   - [test/p5-7-r20-minimal-finish-supervisor.test.ts](/Users/admin/GitProjects/msgcode/test/p5-7-r20-minimal-finish-supervisor.test.ts)
   - [test/p5-7-r10-minimax-anthropic-provider.test.ts](/Users/admin/GitProjects/msgcode/test/p5-7-r10-minimax-anthropic-provider.test.ts)
   - 锁住：
     - 只读任务仍不触发 supervisor
     - mutating/失败任务可记录 supervisor 审计
     - supervisor 的 `CONTINUE` 不再导致继续/阻塞

3. 验证
   - `bun test` 定向用例
   - `npx tsc --noEmit`
   - `npm run docs:check`

## Risks

- 历史测试大量锁了“会继续、会阻塞”的旧语义
- 某些诊断流程可能依赖 `FINISH_SUPERVISOR_BLOCKED`
- 变更后，过去被 supervisor 强拖回去的任务将直接结束，可能暴露出新的模型交付缺陷

回滚策略：

- 若观测性不足，可增强日志，不回滚裁判权
- 若回归过大，可临时回滚本轮实现，但不得把旧裁判行为当长期解

## Test Plan

- `CONTINUE` 不再改变 callCount 链路
- `FINISH_SUPERVISOR_BLOCKED` 不再出现在用户答复
- `actionJournal` 仍出现 `report:finish-supervisor:*`

评审意见：[留空,用户将给出反馈]
