# 任务单：P5.7-R12-T9（Tool Loop 配额续跑真实主流程 Smoke）

优先级：P1

## 回链

- Issue: [0008](../../issues/0008-mainline-quota-continuation-smoke.md)
- Plan: docs/design/plan-260306-mainline-quota-continuation-smoke.md
## Context

- Issue 0007 (Tool Loop 配额策略) 已完成核心功能实现，三个总预算闸门全部接通
- 当前测试覆盖：单元测试、基础设施测试、checkBudgetExhausted 方法测试
- 缺失：真实主流程的端到端 smoke 测试
- 阻断：Issue 0007 无法标记为 done

## Goal / Non-Goals

- Goal: 验证完整的续跑链路：/task run -> tool-loop 触顶 -> continuable=true -> heartbeat 下一轮 -> 最终状态
- Non-Goals: 不修改配额策略本体，不调整默认值，不改 task-supervisor 核心逻辑

## Plan

- [x] 分析现有测试基础设施，确定最小可行方案
- [x] 设计测试场景：
  - [x] 场景 1：续跑成功后 verify completed
  - [x] 场景 2：续跑后预算耗尽进入 failed
- [x] 实现测试框架：
  - [x] Mock `runAgentRoutedChat()` 返回 continuable=true
  - [x] 模拟 heartbeat 多轮调度
  - [x] 验证任务状态转换
- [x] 编写测试用例并验证通过
- [x] 补充文档：测试覆盖说明、运行命令

## Acceptance Criteria

1. 测试文件：test/p5-7-r12-t9-mainline-quota-continuation-smoke.test.ts
2. 至少覆盖 2 个主流程场景（成功续跑完成、预算耗尽失败）
3. 测试能验证：
   - tool-loop 返回 continuable=true
   - task-supervisor 正确处理续跑信号
   - heartbeat 下一轮继续执行
   - 最终状态正确（completed 或 failed）
4. 所有测试通过：npm test -- test/p5-7-r12-t9-mainline-quota-continuation-smoke.test.ts
5. 无回归：npm test 全量通过

## Notes

### 目标链路（固定）

```
1. /task run 创建任务（maxAttempts=5）
   ↓
2. tool-loop 执行（balanced=16/48）
   ↓
3. 达到档位上限（16 次调用或 48 步）
   ↓
4. tool-loop 返回 continuable=true
   ↓
5. task-supervisor 检查总预算:
   - attemptCount < 5 ✓
   - sameToolSameArgsRetryCount < 2 ✓
   - sameErrorCodeStreakCount < 3 ✓
   ↓
6. 总预算未耗尽，更新任务:
   - attemptCount++
   - status: pending
   - nextWakeAtMs: now + heartbeatIntervalMs
   ↓
7. heartbeat 下一轮继续执行
   ↓
8. 重复步骤 2-7，直到:
   - verify 成功 → completed
   - 总预算耗尽 → failed
```

### 测试策略

**最小可行方案**：
- 不启动真实 heartbeat 定时器
- 使用 `/task run` 命令实现入口
- 通过 `TaskSupervisor.handleHeartbeatTick()` 手动驱动 heartbeat 主流程
- Mock `runAgentRoutedChat()` 返回 continuable=true

**为什么不用真实 heartbeat**：
- 真实 heartbeat 依赖事件队列、调度器、定时器
- 测试复杂度高，执行时间长
- 单元测试足以验证续跑逻辑

**测试覆盖优先级**：
1. P0: 续跑成功路径（continuable -> pending -> 下一轮 -> completed）
2. P0: 预算耗尽路径（continuable -> pending -> 下一轮 -> maxAttempts 耗尽 -> failed）
3. P1: sameToolSameArgsRetryLimit 触发
4. P1: sameErrorCodeStreakLimit 触发

### 相关代码

- **任务执行**: src/runtime/task-supervisor.ts (executeTask 方法)
- **续跑逻辑**: src/runtime/task-supervisor.ts (checkBudgetExhausted 方法)
- **配额返回**: src/agent-backend/tool-loop.ts (continuable 信号)
- **透传配额**: src/agent-backend/routed-chat.ts (AgentRoutedChatResult)

### 参考测试

- test/p5-7-r12-t8-tool-loop-quota-strategy.test.ts (当前基础设施测试)
- test/p5-7-r12-t1-*.test.ts (heartbeat 相关测试)

## 完成状态（2026-03-06）

**状态**: ✅ DONE

### 产物

1. `test/p5-7-r12-t9-mainline-quota-continuation-smoke.test.ts`

### 覆盖场景

1. `/task run -> continuable -> heartbeat 下一轮 -> completed`
2. `/task run -> continuable -> heartbeat 下一轮 -> BUDGET_EXHAUSTED -> failed`

### 验证结果

1. `PATH="$HOME/.bun/bin:$PATH" npm test -- test/p5-7-r12-t9-mainline-quota-continuation-smoke.test.ts`
   - 结果：`2 pass / 0 fail`
2. `npx tsc --noEmit`
   - 结果：通过
3. `npm run docs:check`
   - 结果：通过

### 说明

- 本 smoke 已经过 `/task run` 与 `TaskSupervisor.handleHeartbeatTick()` 两个主流程边界
- 当前不启动真实定时器循环，但已验证续跑链路主语义

## Links

- Parent Issue: issues/0007-tool-loop-quota-strategy.md
- Task: docs/tasks/p5-7-r12-t8-tool-loop-quota-strategy.md
- Heartbeat Task: docs/tasks/p5-7-r12-t1-heartbeat-event-wake.md
