# Notes: Benchmark Phase3 Soul Context Fix

## 结论

当前 worktree 已包含 benchmark 所要求的主链修复，本轮没有再追加代码补丁，而是对 benchmark task card 做了复核、验证和证据沉淀。

## 关键代码证据

### 1. task 续跑链显式传入 `includeSoulContext` 与 `sessionKey`

- [/Users/admin/GitProjects/msgcode/src/commands.ts#L665](/Users/admin/GitProjects/msgcode/src/commands.ts#L665)
- [/Users/admin/GitProjects/msgcode/src/commands.ts#L672](/Users/admin/GitProjects/msgcode/src/commands.ts#L672)
- [/Users/admin/GitProjects/msgcode/src/commands.ts#L674](/Users/admin/GitProjects/msgcode/src/commands.ts#L674)

证据：
- `assembleAgentContext({... includeSoulContext: true, sessionKey: runContext.sessionKey })`

### 2. `assembledContext.soulContext` 透传到 `executeAgentTurn()`

- [/Users/admin/GitProjects/msgcode/src/commands.ts#L677](/Users/admin/GitProjects/msgcode/src/commands.ts#L677)
- [/Users/admin/GitProjects/msgcode/src/commands.ts#L682](/Users/admin/GitProjects/msgcode/src/commands.ts#L682)

证据：
- `soulContext: assembledContext.soulContext`

### 3. heartbeat 执行上下文保留 `sessionKey`

- [/Users/admin/GitProjects/msgcode/src/runtime/task-types.ts#L333](/Users/admin/GitProjects/msgcode/src/runtime/task-types.ts#L333)
- [/Users/admin/GitProjects/msgcode/src/runtime/task-supervisor.ts#L437](/Users/admin/GitProjects/msgcode/src/runtime/task-supervisor.ts#L437)
- [/Users/admin/GitProjects/msgcode/test/p6-agent-run-core-phase1.test.ts#L160](/Users/admin/GitProjects/msgcode/test/p6-agent-run-core-phase1.test.ts#L160)

证据：
- `TaskTurnContext` 包含 `sessionKey`
- `this.executeTaskTurn(task, { runId, sessionKey: run.sessionKey, source })`
- 测试断言 `observedContext?.sessionKey === heartbeatRecords[0]?.sessionKey`

## 关键测试证据

### SOUL/context policy

- [/Users/admin/GitProjects/msgcode/test/p6-agent-run-core-phase3-context-policy.test.ts#L36](/Users/admin/GitProjects/msgcode/test/p6-agent-run-core-phase3-context-policy.test.ts#L36)
- [/Users/admin/GitProjects/msgcode/test/p6-agent-run-core-phase3-context-policy.test.ts#L104](/Users/admin/GitProjects/msgcode/test/p6-agent-run-core-phase3-context-policy.test.ts#L104)

锁点：
- `commands.ts` 必须包含 `includeSoulContext`
- `commands.ts` 必须包含 `sessionKey: runContext.sessionKey`
- `commands.ts` 必须包含 `soulContext: assembledContext.soulContext`
- 统一 assembler 能返回可用的 `soulContext`

### heartbeat sessionKey

- [/Users/admin/GitProjects/msgcode/test/p6-agent-run-core-phase1.test.ts#L148](/Users/admin/GitProjects/msgcode/test/p6-agent-run-core-phase1.test.ts#L148)

锁点：
- heartbeat 执行上下文必须带 `sessionKey`

## 范围说明

- 本轮未处理 benchmark 之外的 dirty worktree 文件。
- `npx tsc --noEmit` 的报错仍是仓库既有问题，不属于这道 benchmark 新引入的回归。
