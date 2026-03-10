# Agent Core Benchmark Task 01

## 任务名

修复 task 续跑链 SOUL 丢失问题，并补齐统一 context policy 回归锁

## 任务定位

这是一道用于验证 `Agent Core` 复杂任务能力的标准题。

它不是单点小修，而是一道小范围、可闭环、可验收的工程型复杂任务，主要测试：

- 跨文件代码理解能力
- 主链一致性修复能力
- 范围控制能力
- 回归测试意识
- 结构化回传与验收能力

## 输入

给定一条 review finding：

> `src/commands.ts:664`
>
> task 续跑链并未完整复用统一 context policy，SOUL 仍然只在 message 链生效。
>
> 这轮确实把 task 续跑链接到了 `assembleAgentContext()`，但这里只传了 `checkpoint/summary/window`，没有像 message 链那样传 `includeSoulContext` 和 `sessionKey`，随后也没有把 `assembledContext.soulContext` 继续透传给 `executeAgentTurn()`。结果是：普通消息链和 task/heartbeat 链仍然跑在两套不同强度的上下文策略上，长期任务续跑会丢掉 SOUL 约束与对应观测字段，和本轮“统一 summary/window/checkpoint/soul/compact 规则”的验收口径不一致。

## 任务目标

在不扩 scope 的前提下，修复 task/heartbeat 续跑链的 SOUL 注入缺口，让它与普通 message 链使用同一套完整 context policy，并补齐最小回归测试。

## 本轮范围

- 允许修改：
  - `/Users/admin/GitProjects/msgcode/src/commands.ts`
  - `/Users/admin/GitProjects/msgcode/src/runtime/task-types.ts`
  - `/Users/admin/GitProjects/msgcode/src/runtime/task-supervisor.ts`
  - `/Users/admin/GitProjects/msgcode/test/p6-agent-run-core-phase3-context-policy.test.ts`
  - `/Users/admin/GitProjects/msgcode/test/p6-agent-run-core-phase1.test.ts`
- 允许补充最小必要测试与 issue 证据。
- 允许补充最小日志/断言，但不得新长一层控制面。

## 非范围

- 不做 gateway
- 不做 run events
- 不做 session 平台重构
- 不做 memory 平台重构
- 不做 surface / mobile / PWA
- 不顺手重构 `handlers.ts`
- 不扩大到 Phase 4 及以后

## 硬要求

1. task 续跑链必须显式传入 `includeSoulContext`
2. task 续跑链必须显式传入 `sessionKey`
3. `assembledContext.soulContext` 必须继续透传到 `executeAgentTurn()`
4. heartbeat 续跑链不得丢失 `sessionKey`
5. 不允许把所有行为塞进 `TaskSupervisor`
6. 不允许为此新增 manager / platform / orchestrator 层

## 推荐执行步骤

1. 阅读 message 链与 task 链当前上下文装配差异
2. 找到 `assembleAgentContext()` 在 message 链中的完整调用口径
3. 对齐 task 续跑链的 `includeSoulContext`、`sessionKey`、`soulContext`
4. 检查 heartbeat 续跑执行上下文是否保持相同语义
5. 补最小测试锁
6. 运行回归测试并结构化回传

## 验收标准

必须同时满足：

1. 普通 message 链与 task/heartbeat 链使用同一套完整 context policy
2. 测试能直接证明 `includeSoulContext/sessionKey/soulContext` 已进入 task 续跑链
3. heartbeat 执行上下文具备 `sessionKey`
4. 相关测试通过
5. 不引入新的厚层和范围漂移

## 期望输出位置

本题执行结果统一写到下面目录：

- 任务回传文档：
  - `/Users/admin/GitProjects/msgcode/aidocs/artifacts/benchmark-phase3-soul-context-fix/result.md`
- 测试记录：
  - `/Users/admin/GitProjects/msgcode/aidocs/artifacts/benchmark-phase3-soul-context-fix/test-output.txt`
- 如有补充说明：
  - `/Users/admin/GitProjects/msgcode/aidocs/artifacts/benchmark-phase3-soul-context-fix/notes.md`

## 回传格式

执行者回传时必须使用下面结构：

```text
给验收同学：

任务：
- 修复 task 续跑链 SOUL 丢失问题，并补齐统一 context policy 回归锁

原因：
- 普通 message 链与 task/heartbeat 链上下文策略漂移
- 长期任务续跑丢失 SOUL 约束与 session 语义

过程：
- 说明阅读了哪些关键文件
- 说明具体改动点
- 说明补了哪些测试

结果：
- 列出修复后的关键行为
- 说明是否仍有剩余边界

验证：
- 粘贴测试命令
- 粘贴关键通过结果

风险 / 卡点：
- 说明是否仍有既有类型错误或历史 dirty worktree 风险

后续：
- 说明这题关闭后下一步应进入哪一阶段
```

## 判分点

### 通过

- 正确修中主链
- 范围控制住
- 测试锁到真实语义
- 回传结构化清晰

### 不通过

- 只改了表层调用，SOUL 实际仍没透传
- 只锁“调用了 assembler”，没锁关键字段
- 顺手扩 scope 到 run events、gateway 或 memory
- 没有真实测试证据

## 备注

这道题是一个标准的 `Agent Core` 工程型复杂任务 benchmark，可重复用于比较不同执行代理在：

- 代码理解
- 结构约束
- 小范围闭环修复
- 结构化交付

上的稳定性。
