---
id: 0007
title: Tool Loop 配额策略与多轮续跑收口
status: done
owner: agent
labels: [feature, refactor, docs]
risk: medium
scope: agent-backend/tool-loop/runtime/task-supervisor/config
plan_doc: docs/design/plan-260306-tool-loop-quota-strategy.md
links:
  - issues/0006-agent-relentless-task-closure.md
  - docs/tasks/p5-7-r3k-tool-loop-slo-gate.md
  - docs/tasks/p5-7-r12-t3-verify-phase-mainline.md
  - docs/tasks/p5-7-r11-no-subagent-execution-playbook.md
created: 2026-03-06
---

## Context

- 当前 `msgcode` 的单轮 tool-loop 已有固定上限：
  - `MAX_TOOL_CALLS_PER_TURN = 8`
  - `MAX_TOOL_STEPS_TOTAL = 24`
- 这些上限能防止失控自旋，但对复杂任务可能过早截断，用户感受为“任务还没做完就提前结束”。
- 同时，系统已经具备 `heartbeat + task-supervisor + verify gate` 的多轮续跑基础，因此不应简单把单轮工具上限放大到接近无限。
- 用户反馈参考 `pi` 的“更敢申请工具”风格，希望适度增加模型申请工具的机会，但不能引入无限循环或长时间自旋。

## Goal / Non-Goals

- Goal: 为 tool-loop 建立“单轮上限 + 多轮续跑 + 尝试预算”三层配额策略，减少复杂任务被过早截断的概率。
- Non-Goals: 不引入无限工具调用；不改 provider 协议；不做多代理协作。

## Plan

- [x] 将单轮工具调用上限改为可配置，并做温和上调
- [x] 为任务型执行建立总尝试预算，避免 heartbeat 无上限重试
- [x] 将 `TOOL_LOOP_LIMIT_EXCEEDED` 与任务状态机联动，支持”本轮截断但任务继续”
- [x] 补回归锁，验证复杂任务不会提前结束，也不会无限自旋

## Acceptance Criteria

1. 单轮工具调用上限不再硬编码为不可配置常量。
2. 任务型执行在本轮触顶时，可进入下一轮继续推进，而不是直接宣告失败。
3. 系统存在明确总预算：超过预算后必须进入 `failed` 或 `blocked`，不能无限续跑。
4. `verify` 仍然是完成闸门；提高配额不能绕过验证。
5. 日志可观察：`toolLoopBudget/perTurnLimit/remainingAttempts/continuationReason`。

## Notes

- Code:
  - `src/agent-backend/tool-loop.ts`
  - `src/runtime/task-supervisor.ts`
  - `src/agent-backend/types.ts`
- Docs:
  - `docs/tasks/p5-7-r3k-tool-loop-slo-gate.md`
  - `docs/tasks/p5-7-r12-t3-verify-phase-mainline.md`
  - `issues/0006-agent-relentless-task-closure.md`
- 冻结默认值建议：
  - `perTurnToolCallLimit = 16`
  - `perTurnToolStepLimit = 48`
  - `taskMaxAttempts = 5`
  - `sameToolSameArgsRetryLimit = 2`
  - `sameErrorCodeStreakLimit = 3`
- 档位建议：
  - `conservative = 8 / 24`
  - `balanced = 16 / 48`
  - `aggressive = 20 / 64`
- 约束：
  - 默认走 `balanced`
  - `20 / 64` 为单轮硬上限；超过后必须交由下一轮 heartbeat 继续，不允许继续拉长单轮

## 实施总结（2026-03-06）

### 第一阶段：单轮配额策略 + 续跑信号

1. **配额策略实现**
   - 在 `src/agent-backend/types.ts` 中添加配额字段到 `AgentToolLoopOptions` 和 `AgentToolLoopResult`
   - 在 `src/agent-backend/tool-loop.ts` 中实现三层配额策略：
     - 三个档位：conservative (8/24), balanced (16/48), aggressive (20/64)
     - 默认使用 balanced 档位
     - 硬上限：20/64（禁止超过）
   - 支持运行时覆盖：`perTurnToolCallLimit` 和 `perTurnToolStepLimit`

2. **续跑机制（返工修复）**
   - **修复前**: balanced (16/48) 触顶 → `continuable: false` → 直接终止 ❌
   - **修复后**: balanced (16/48) 触顶 → `continuable: true` → heartbeat 下一轮继续 ✓
   - **修复位置**:
     - `src/agent-backend/tool-loop.ts` 第 796-816 行（工具调用数检查）
     - `src/agent-backend/tool-loop.ts` 第 908-930 行（工具步骤数检查）

3. **测试修复**
   - 修复所有因 verify phase（P5.7-R12-T3）导致的 actionJournal 数量变化
   - 为期望超限的测试显式设置 `quotaProfile: "conservative"`
   - 所有测试通过：1454 pass / 0 fail

4. **文档同步**
   - 为相关任务文档添加 Issue 0007 和 Plan 回链

### 第二阶段：总预算与 task-supervisor 联动

1. **扩展 task-types.ts**
   - **文件**: `src/runtime/task-types.ts`
   - **新增字段**:
     - `TaskRecord.sameToolSameArgsRetryCount`: 同工具同参数重试次数
     - `TaskRecord.lastToolCall`: 上次工具调用记录（用于检测同工具同参数）
     - `TaskRecord.sameErrorCodeStreakCount`: 同错误码连续失败次数
   - **修改默认值**:
     - `maxAttempts`: 3 → 5
     - `DEFAULT_SUPERVISOR_CONFIG.defaultMaxAttempts`: 3 → 5
   - **扩展诊断输出**: `TaskDiagnostics` 包含总预算字段

2. **task-supervisor 集成**
   - **文件**: `src/runtime/task-supervisor.ts`
   - **新增常量**:
     - `SAME_TOOL_SAME_ARGS_RETRY_LIMIT = 2`
     - `SAME_ERROR_CODE_STREAK_LIMIT = 3`
   - **修改 `executeTask` 方法**:
     - 检查 `result.continuable` 信号
     - 调用 `checkBudgetExhausted()` 检查总预算
     - 总预算未耗尽：更新 `attemptCount`、`sameToolSameArgsRetryCount`、`lastToolCall`，状态转 `pending`
     - 总预算耗尽：状态转 `failed`，错误码 `BUDGET_EXHAUSTED`
   - **新增 `checkBudgetExhausted` 方法**:
     - 检查 1: `attemptCount >= maxAttempts`
     - 检查 2: `sameToolSameArgsRetryCount >= 2`
     - 检查 3: `sameErrorCodeStreakCount >= 3`（第三阶段已完成）

3. **routed-chat 透传配额信息**
   - **文件**: `src/agent-backend/routed-chat.ts`
   - **修改**:
     - 扩展 `AgentRoutedChatResult` 接口，添加配额字段
     - 在 3 处 `runAgentToolLoop` 调用后透传配额信息：
       - `continuable`
       - `quotaProfile`
       - `perTurnToolCallLimit`
       - `perTurnToolStepLimit`
       - `remainingToolCalls`
       - `remainingSteps`
       - `continuationReason`

4. **端到端 smoke 测试**
   - **文件**: `test/p5-7-r12-t8-tool-loop-quota-strategy.test.ts`（新建）
   - **覆盖**:
     - 总预算字段初始化验证
     - 默认值验证（maxAttempts=5）
     - TaskSupervisor 接收 continuable 信号
     - 预算耗尽场景单元测试
     - 诊断输出包含总预算字段
   - **10 tests pass / 0 fail**

### 验收证据（第三阶段完成后，2026-03-06 架构复核）

- ✓ `npx tsc --noEmit` - TypeScript 编译检查通过
- ✓ `npm run docs:check` - 文档同步检查通过
- ✓ `npm test -- test/p5-7-r12-t8-tool-loop-quota-strategy.test.ts` - 14 pass / 0 fail
- ✓ `npm test` - 1464 pass / 0 fail（新增 4 个预算闸门测试，以实际命令输出为准）
- ✓ 架构复核通过：sameErrorCodeStreakCount 已接通，三个总预算闸门全部工作

### 冻结默认值（已落地）

**单轮配额**:
- 默认档位：`balanced = 16 / 48`
- 对照档位：`conservative = 8 / 24`, `aggressive = 20 / 64`
- 单轮硬上限：`20 / 64`

**总预算**:
- `taskMaxAttempts = 5`
- `sameToolSameArgsRetryLimit = 2`
- `sameErrorCodeStreakLimit = 3`

### 边界约束（已遵守）

- ✓ 不改 `balanced=16/48` 这组默认值
- ✓ 不再碰第一阶段已通过的单轮配额逻辑
- ✓ 不扩到多任务/多代理
- ✓ verify gate 不能放松（仍然存在）

### 实现路径（端到端）

```
1. 用户发起: /task run "执行复杂任务"
   ↓
2. task-supervisor 创建任务（maxAttempts=5）
   ↓
3. tool-loop 执行（balanced=16/48）
   ↓
4. 达到档位上限（16 次调用或 48 步）
   ↓
5. tool-loop 返回 continuable=true
   ↓
6. task-supervisor 检查总预算:
   - attemptCount < 5 ✓
   - sameToolSameArgsRetryCount < 2 ✓
   - sameErrorCodeStreakCount < 3 ✓
   ↓
7. 总预算未耗尽，更新任务:
   - attemptCount++
   - status: pending
   - nextWakeAtMs: now + heartbeatIntervalMs
   ↓
8. heartbeat 下一轮继续执行
   ↓
9. 重复步骤 3-8，直到:
   - verify 成功 → completed
   - 总预算耗尽 → failed
```

### 风险说明

- ✓ 提高单轮配额上限后，默认 balanced 档位 (16/48) 已做温和上调
- ✓ 多轮续跑依赖 heartbeat 和 task-supervisor 配合，状态机正确处理 `continuable` 信号
- ✓ 硬上限 (20/64) 禁止超过，防止单轮无限变长
- ✓ 总预算限制防止无限续跑（maxAttempts=5, sameToolSameArgsRetryLimit=2）

### 当前状态

**状态: done**

**完成度**: 100%

**已完成**:
- ✓ 单轮配额策略
- ✓ 续跑信号机制
- ✓ 总预算字段定义
- ✓ task-supervisor 集成
- ✓ sameToolSameArgsRetryLimit 已接通（第三阶段修正）
- ✓ sameErrorCodeStreakLimit 已实现（第三阶段修正）
- ✓ routed-chat 透传配额信息
- ✓ 三个总预算闸门的单元测试（第三阶段修正）

**待完成**:
- 无

### 架构复核（2026-03-06）

**复核结论**: 第三阶段修正通过认可

**关键确认**:
1. ✓ task-supervisor.ts 里 sameErrorCodeStreakCount 已真正接入预算检查，不再是 TODO
2. ✓ tool-loop.ts 的 continuable=true 返回已补上 toolCall，sameToolSameArgsRetryLimit 现在能在真实续跑路径上工作

**复跑验证**:
- ✓ npx tsc --noEmit：通过
- ✓ npm run docs:check：通过
- ✓ npm test -- test/p5-7-r12-t8-tool-loop-quota-strategy.test.ts：14 pass / 0 fail
- ✓ npm test：1468 pass / 0 fail

**功能状态**:
- sameErrorCodeStreakCount：已接通
- 三个总预算闸门：已接通

**保留意见**:
- 无阻断保留意见

**下一步**:
- 补真实主流程 smoke 测试（/task run -> tool-loop 触顶 -> continuable -> heartbeat 下一轮 -> budget exhausted or verify completed）

### 第三阶段修正（2026-03-06 架构评审反馈）- 已完成并通过架构复核:

- **[P1] 修正 sameToolSameArgsRetryLimit 半接通状态** ✓（架构复核确认）:
  - 在 tool-loop.ts 的 4 处 `continuable=true` 返回中补上 `toolCall`
  - 使用最后执行的工具调用：`executedToolCalls[executedToolCalls.length - 1]`
  - **架构确认**: sameToolSameArgsRetryLimit 现在能在真实续跑路径上工作

- **[P1] 实现 sameErrorCodeStreakCount 检查** ✓（架构复核确认）:
  - 在 task-supervisor.ts 中实现完整的检查逻辑
  - 从 actionJournal 中提取最后一个错误码（continuable 分支和正常完成分支）
  - 在异常分支中使用 "EXECUTION_FAILED" 作为通用错误码
  - 更新 lastErrorCode 和 sameErrorCodeStreakCount
  - **架构确认**: task-supervisor.ts 里 sameErrorCodeStreakCount 已真正接入预算检查，不再是 TODO

- **[P2] 单元测试覆盖三个总预算闸门** ✓:
  - 新增 4 个测试用例，覆盖 maxAttempts, sameToolSameArgsRetryLimit, sameErrorCodeStreakLimit 耗尽场景
  - 新增 1 个测试用例，验证总预算未耗尽时允许续跑
  - 所有测试通过：1464 pass / 0 fail（新增 4 个测试，以实际命令输出为准）

- **[P3] 真实主流程 smoke 测试**（下一步）:
  - 当前测试是"预算与续跑基础设施 smoke"，还不是完整主流程烟测
  - 需要验证：/task run -> tool-loop 触顶 -> continuable -> heartbeat 下一轮 -> budget exhausted or verify completed
  - 这是 0007 done 的最后一项阻断项

## Links

- Plan: `docs/design/plan-260306-tool-loop-quota-strategy.md`
- Task: `docs/tasks/p5-7-r12-t8-tool-loop-quota-strategy.md`
- 子任务（真实主流程 Smoke）: `docs/tasks/p5-7-r12-t9-mainline-quota-continuation-smoke.md` / `issues/0008-mainline-quota-continuation-smoke.md`

---

## 第三阶段修正总结（2026-03-06）

### 完成的工作

1. **修复 TypeScript 编译错误**
   - 问题：result 变量在 catch 块中可能未赋值
   - 方案：将 result 声明移回 try 块内部，在 catch 块中直接使用 "EXECUTION_FAILED" 作为错误码

2. **完成 sameErrorCodeStreakCount 全分支实现**
   - ✓ continuable 分支（可续跑）：从 actionJournal 提取最后错误码
   - ✓ 正常完成分支（不可续跑）：从 actionJournal 提取最后错误码
   - ✓ 异常分支：使用 "EXECUTION_FAILED" 作为通用错误码

3. **新增 5 个单元测试**（test/p5-7-r12-t8-tool-loop-quota-strategy.test.ts）
   - ✓ 验证 maxAttempts 耗尽场景
   - ✓ 验证 sameToolSameArgsRetryLimit 耗尽场景
   - ✓ 验证 sameErrorCodeStreakLimit 耗尽场景
   - ✓ 验证总预算未耗尽时允许续跑
   - ✓ 直接测试 checkBudgetExhausted 私有方法

### 架构复核结果

**关键确认**:
1. ✓ task-supervisor.ts 里 sameErrorCodeStreakCount 已真正接入预算检查，不再是 TODO
2. ✓ tool-loop.ts 的 continuable=true 返回已补上 toolCall，sameToolSameArgsRetryLimit 现在能在真实续跑路径上工作

**功能状态**:
- sameErrorCodeStreakCount：已接通
- 三个总预算闸门：已接通
- Issue 0007：继续保持 doing 是对的

**保留意见**:
- p5-7-r12-t8-tool-loop-quota-strategy.test.ts 现在更像"预算与续跑基础设施 smoke"，还不是完整 /task run -> tool-loop -> heartbeat -> verify/failed 的真实主流程烟测
- 这不阻断本次修正验收，但仍阻断 0007 done

**下一步**:
- 无

### 最后阻断项收口（2026-03-06）

- **[P3] 真实主流程 smoke 测试** ✓:
  - 子 issue：`issues/0008-mainline-quota-continuation-smoke.md`
  - 子任务：`docs/tasks/p5-7-r12-t9-mainline-quota-continuation-smoke.md`
  - 已覆盖：
    - `/task run -> continuable -> heartbeat -> completed`
    - `/task run -> continuable -> heartbeat -> BUDGET_EXHAUSTED -> failed`
  - 验证结果：
    - `PATH="$HOME/.bun/bin:$PATH" npm test -- test/p5-7-r12-t9-mainline-quota-continuation-smoke.test.ts`：`2 pass / 0 fail`
    - `npx tsc --noEmit`：通过
    - `npm run docs:check`：通过
