# 任务单：P5.7-R12-T3（`verify` 阶段入主链）

优先级：P0

## 回链

- Issue: [0006](../../issues/tk0006.dne.agent.agent-relentless-task-closure.md)
- Issue: [0007](../../issues/tk0007.dne.agent.tool-loop-quota-strategy.md)
- Plan: docs/plan/pl0006.dne.agent.agent-relentless-task-closure.md
- Plan: docs/plan/pl0007.dne.agent.tool-loop-quota-strategy.md

## 目标（冻结）

1. 主链阶段从 `plan -> act -> report` 升级为 `plan -> act -> verify -> report`。  
2. 落地硬规则：`Verify before deliver`。  
3. 无验证证据时，不允许输出“已完成”。

## 可行性依据（代码现状）

1. `src/agent-backend/routed-chat.ts` 已有显式 phase 日志，可增补 `verify`。  
2. `src/agent-backend/tool-loop.ts` 已输出 `actionJournal`，可承载验证证据。  
3. 当前 `ActionJournalEntry.phase` 仅含 `plan|act|report`，扩展成本可控。

## 范围（冻结）

涉及文件（预期）：

1. `/Users/admin/GitProjects/msgcode/src/agent-backend/types.ts`
2. `/Users/admin/GitProjects/msgcode/src/agent-backend/routed-chat.ts`
3. `/Users/admin/GitProjects/msgcode/src/agent-backend/tool-loop.ts`
4. `/Users/admin/GitProjects/msgcode/src/tools/types.ts`（如需新增验证失败错误码）
5. `/Users/admin/GitProjects/msgcode/test/p5-7-r12-t3-verify-phase-mainline.test.ts`（新建）

## 范围外（冻结）

1. 不做“结果质量评分”类语义验证（只做执行证据验证）。  
2. 不变更路由分类策略。  
3. 不改现有降级策略阈值（SLO 维持现状）。

## 设计约束（冻结）

1. `verify` 必须有独立 phase 日志：`phase=verify`, `kernel=exec|router`。  
2. 最小验证矩阵：
   - `bash`：`exitCode===0` 且失败信息可诊断
   - 文件修改：回读成功或目标文件存在
   - 生成类：输出文件存在且大小 > 0
3. 失败错误码固定（建议）：`TOOL_VERIFY_FAILED`。

## 实施步骤（每步一提交）

1. `feat(p5.7-r12-t3): extend action journal with verify phase`
   - 扩展 phase union
   - 增加 verify journal entry
2. `feat(p5.7-r12-t3): add verify gate before report`
   - `report` 前执行 verify
   - verify 失败时返回失败响应，不伪完成
3. `test(p5.7-r12-t3): add verify-phase regression locks`
   - phase 顺序锁
   - 无 verify 不得完成锁
   - 失败保真锁（errorCode/diagnostics）

## 验收门（冻结）

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`
4. 真实证据：
   - 文件写入任务能看到 verify 日志
   - verify 失败时不会返回“已完成”

## 依赖关系

1. 前置：R12-T2（调度与运行稳定）  
2. 后置：R12-T4/T5 的可回放与预算统计更可信

## 风险与缓解

1. 风险：verify 过严导致误报失败  
   缓解：先落最小验证矩阵，不做语义级验证。  
2. 风险：测试大量受 phase 变更影响  
   缓解：统一行为断言，不用源码字符串锁。
