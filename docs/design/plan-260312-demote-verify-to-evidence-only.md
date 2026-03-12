# 将 verify 降为纯证据层

## Problem

`finish supervisor` 已退出热路径，但 `verify` 仍在通过另一条链抢执行权：

- `task-supervisor` 在任务 turn 完成后，会因 `verifyResult.ok === false` 把任务从 `completed` 打成 `blocked`
- `updateTaskResult()` 还要求 `completed` 必须带 `verifyEvidence`，否则强制退回 `running`
- `run-events` 会把 verify 失败发成 `run:block`

这意味着 verify 仍然是第二层裁判，而不是单纯证据。

## Occam Check

- 不加它，系统具体坏在哪？
  - 即使模型和工具链已经结束，verify 仍会在下游把任务状态篡改成 `blocked`，用户和任务主链拿到的不是模型/工具真实完成语义。
- 用更少的层能不能解决？
  - 能。保留 verify 数据，只删除它对状态机和 run event 的控制权。
- 这个改动让主链数量变多了还是变少了？
  - 变少了。删掉“工具执行完成 -> verify 再裁判一次”的下游旁路。

## Decision

选定方案：将 verify 降为 **evidence-only**。

- `verifyResult` / `verifyEvidence` 继续保留
- `task-supervisor` 不再因为 verify 失败改写 `completed` / `blocked`
- `updateTaskResult()` 不再要求 completed 必须带 verifyEvidence
- `run-events` 不再因 verify 失败发 `run:block`

## Alternatives

### 方案 A：保留现状

- 优点：现有测试与状态机不动
- 缺点：verify 继续充当第二裁判

### 方案 B：verify 降为证据层

- 优点：最小切口，直击“抢执行权”问题
- 缺点：verify 失败不再自动暴露为 blocked，需要靠证据和日志自己判断

### 方案 C：连 `runVerifyPhase()` 一起删

- 优点：更激进
- 缺点：把“删裁判语义”和“删证据收集”混成一刀，风险更大

推荐：方案 B

## Plan

1. 更新 [src/runtime/task-supervisor.ts](/Users/admin/GitProjects/msgcode/src/runtime/task-supervisor.ts)
   - 删除 verify 失败导致 `executionResult.status = "blocked"` 的逻辑
   - `completed` 状态不再因缺少 verifyEvidence 回退到 `running`

2. 更新 [src/runtime/run-events.ts](/Users/admin/GitProjects/msgcode/src/runtime/run-events.ts)
   - `emitToolLoopRunEvents()` 不再因 verify 失败追加 `run:block`

3. 更新 [src/runtime/task-types.ts](/Users/admin/GitProjects/msgcode/src/runtime/task-types.ts)
   - 把 verify 证据注释从“completed 必须有”收口为“可选证据”

4. 更新测试
   - [test/p5-7-r12-agent-relentless-task-closure.test.ts](/Users/admin/GitProjects/msgcode/test/p5-7-r12-agent-relentless-task-closure.test.ts)
   - [test/p6-agent-run-core-phase4-run-events.test.ts](/Users/admin/GitProjects/msgcode/test/p6-agent-run-core-phase4-run-events.test.ts)
   - 视需要补齐 task heartbeat 相关行为锁

5. 更新 [docs/CHANGELOG.md](/Users/admin/GitProjects/msgcode/docs/CHANGELOG.md)

6. 验证
   - `bun test` 定向回归
   - `npx tsc --noEmit`
   - `npm run docs:check`

## Risks

- 历史测试和部分诊断文案假设了 verify 失败会导致 blocked，需要整体翻口径
- 某些依赖 `blockedReason` 的二级流程会失去这条隐式信号，但这正是本轮要删除的越权行为

回滚策略：

- 若回归过大，可整体回滚 `task-supervisor/run-events/task-types`、对应测试、issue/plan 和 changelog 本轮改动

评审意见：[留空,用户将给出反馈]
