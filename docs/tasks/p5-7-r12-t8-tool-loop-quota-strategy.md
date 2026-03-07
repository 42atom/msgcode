# 任务单：P5.7-R12-T8（Tool Loop 配额策略与多轮续跑收口）

优先级：P1

Issue: 0007
Plan: docs/design/plan-260306-tool-loop-quota-strategy.md

## 目标（冻结）

1. 单轮工具调用上限改为可配置，并温和上调。  
2. 复杂任务在本轮触顶后可以进入下一轮继续，而不是直接失败。  
3. 建立总尝试预算，防止 heartbeat 多轮续跑变成无限自旋。  
4. `verify` 继续作为完成闸门。

## 可行性依据（代码现状）

1. `src/agent-backend/tool-loop.ts` 已有明确上限与 `TOOL_LOOP_LIMIT_EXCEEDED` 语义。  
2. `src/runtime/task-supervisor.ts` 已能通过 heartbeat 续跑 `pending|running` 任务。  
3. `verify` 已进入主链，可作为完成闸门复用。  

## 范围（冻结）

涉及文件（预期）：

1. `/Users/admin/GitProjects/msgcode/src/agent-backend/tool-loop.ts`
2. `/Users/admin/GitProjects/msgcode/src/agent-backend/types.ts`
3. `/Users/admin/GitProjects/msgcode/src/runtime/task-supervisor.ts`
4. `/Users/admin/GitProjects/msgcode/src/runtime/task-types.ts`
5. `/Users/admin/GitProjects/msgcode/src/config/workspace.ts`（若将上限配置化）
6. `/Users/admin/GitProjects/msgcode/test/p5-7-r12-tool-loop-quota-strategy.test.ts`（新建）

## 范围外（冻结）

1. 不改 provider 协议。  
2. 不做无限工具调用。  
3. 不改多代理/多任务调度。  

## 设计约束（冻结）

1. 单轮上限必须仍有硬 cap，不允许无限。  
2. 总预算必须显式可诊断。  
3. `completed` 仍必须依赖 verify 成功。  
4. 复杂任务优先走“多轮续跑”，不是“单轮无限加长”。  
5. 默认档位冻结为 `balanced = 16 / 48`。  
6. 单轮硬上限冻结为 `20 / 64`。  

## 实施步骤（每步一提交）

1. `feat(p5.7-r12-t8): make tool-loop limits configurable`
2. `feat(p5.7-r12-t8): distinguish per-turn limit from total budget`
3. `feat(p5.7-r12-t8): continue task after turn limit via heartbeat`
4. `test(p5.7-r12-t8): add quota-strategy regression locks`

## 验收门（冻结）

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`
4. 真实证据：
   - 复杂任务在单轮触顶后仍可下一轮继续
   - 超过总预算后进入终态失败
   - verify 未通过时不会 completed
5. 日志中可见：
   - `quotaProfile=balanced`
   - `perTurnToolCallLimit=16`
   - `perTurnToolStepLimit=48`
   - 超过单轮硬上限时的 continuation 证据

## 风险与缓解

1. 风险：提高单轮上限后时延抬高  
   缓解：只做温和上调，多轮续跑优先。  
2. 风险：预算语义不清导致 supervisor 行为漂移  
   缓解：增加 continuation reason 与 budget exhausted 字段。  
