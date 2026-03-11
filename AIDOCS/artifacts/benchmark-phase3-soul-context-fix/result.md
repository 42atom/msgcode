给验收同学：

任务：
- 修复 task 续跑链 SOUL 丢失问题，并补齐统一 context policy 回归锁。
- 本轮严格对照 benchmark task card：[/Users/admin/GitProjects/msgcode/aidocs/notes/benchmark-task-phase3-soul-context-fix-260310.md](/Users/admin/GitProjects/msgcode/aidocs/notes/benchmark-task-phase3-soul-context-fix-260310.md)。

原因：
- benchmark 题目要求确认 task/heartbeat 续跑链与普通 message 链使用同一套完整 context policy。
- 核心验收点是 `includeSoulContext`、`sessionKey`、`assembledContext.soulContext` 与 heartbeat 执行上下文不能丢失，而不是只锁“调用了 assembler”。

过程：
- 阅读并对照了 benchmark task card、主线 Plan、Task Pack。
- 核对了 message 链与 task/heartbeat 链的关键落点：
  - [/Users/admin/GitProjects/msgcode/src/commands.ts#L664](/Users/admin/GitProjects/msgcode/src/commands.ts#L664)
  - [/Users/admin/GitProjects/msgcode/src/runtime/task-types.ts#L333](/Users/admin/GitProjects/msgcode/src/runtime/task-types.ts#L333)
  - [/Users/admin/GitProjects/msgcode/src/runtime/task-supervisor.ts#L437](/Users/admin/GitProjects/msgcode/src/runtime/task-supervisor.ts#L437)
  - [/Users/admin/GitProjects/msgcode/test/p6-agent-run-core-phase3-context-policy.test.ts#L36](/Users/admin/GitProjects/msgcode/test/p6-agent-run-core-phase3-context-policy.test.ts#L36)
  - [/Users/admin/GitProjects/msgcode/test/p6-agent-run-core-phase1.test.ts#L148](/Users/admin/GitProjects/msgcode/test/p6-agent-run-core-phase1.test.ts#L148)
- 运行 benchmark 相关回归与最小类型检查，并把输出记录到：
  - [/Users/admin/GitProjects/msgcode/aidocs/artifacts/benchmark-phase3-soul-context-fix/test-output.txt](/Users/admin/GitProjects/msgcode/aidocs/artifacts/benchmark-phase3-soul-context-fix/test-output.txt)

结果：
- 当前 worktree 已满足 benchmark 修复目标，不需要再追加代码补丁：
  - task 续跑链已显式传入 `includeSoulContext: true`
  - task 续跑链已显式传入 `sessionKey: runContext.sessionKey`
  - `assembledContext.soulContext` 已透传到 `executeAgentTurn()`
  - heartbeat 执行上下文保留了 `sessionKey`
- 相关测试已经锁到真实语义，不只是锁“调用了 assembler”：
  - `commands.ts` 需包含 `includeSoulContext/sessionKey/soulContext`
  - heartbeat 断言 `observedContext.sessionKey === heartbeat run.sessionKey`
- 本轮主要新增的是 benchmark 证据产物，不扩 scope 到 gateway、run events、memory 平台或其他 dirty worktree 文件。

验证：
- `PATH="$HOME/.bun/bin:$PATH" bun test test/p6-agent-run-core-phase3-context-policy.test.ts test/p6-agent-run-core-phase1.test.ts test/p5-7-r12-agent-relentless-task-closure.test.ts test/p5-7-r12-t9-mainline-quota-continuation-smoke.test.ts`
  - `34 pass / 0 fail`
- `npx tsc --noEmit`
  - 仍失败，但仅见仓库既有错误：`src/feishu/transport.ts`、`src/routes/cmd-model.ts`、`src/routes/cmd-schedule.ts`、`src/routes/cmd-tooling.ts`

风险 / 卡点：
- 这道 benchmark 在当前 worktree 中已被先前 Phase 3 修复命中，所以本轮没有新增代码 diff；如果只看“本轮新改代码”，会误以为没有动作，实际动作是对 benchmark 卡进行复核与证据闭环。
- `npx tsc --noEmit` 仍非全绿，但没有看到 benchmark 允许文件里的新增类型错误。
- worktree 仍然很脏，本轮未处理任何非 benchmark 范围的历史改动。

后续：
- 这道 benchmark 可以关闭。
- Agent Core Run Core 主线可继续按主线 Plan 的后续 benchmark / phase 推进，但不要借这题顺手扩到新控制层。
