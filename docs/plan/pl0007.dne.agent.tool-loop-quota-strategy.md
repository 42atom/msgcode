# Plan: Tool Loop 配额策略与多轮续跑收口

Issue: 0007

## Problem

当前 `msgcode` 的 tool-loop 用固定上限防止自旋：

1. `MAX_TOOL_CALLS_PER_TURN = 8`
2. `MAX_TOOL_STEPS_TOTAL = 24`

这个策略在早期是合理的，但在“追打型任务闭环”能力已具备后，单轮上限过低会让复杂任务出现两类问题：

1. 一轮内还没完成就直接返回 `TOOL_LOOP_LIMIT_EXCEEDED`
2. 任务状态机没有把“本轮触顶但仍可继续”视作正常中间态

如果直接把上限无限放大，又会引入新的风险：

1. 单轮卡住太久，用户感知变差
2. 工具自旋时间变长，失败成本更高
3. 即使有 `verify gate`，也可能在无效路径上消耗过多时间

因此需要把“单轮上限”和“多轮续跑预算”分开设计。

## Decision

采用“**单轮温和上调 + 总预算显式化 + 本轮触顶可续跑**”方案。

核心决策：

1. 单轮工具调用上限改为可配置，不再是写死常量
2. 默认只做有限上调，不做无限工具调用
3. 将 `TOOL_LOOP_LIMIT_EXCEEDED` 分为两种语义：
   - 单轮触顶但任务仍可继续：进入下一轮
   - 总预算耗尽：进入终态失败
4. heartbeat + task-supervisor 负责多轮继续，不把所有复杂度塞进单轮
5. `verify` 继续保持为完成闸门，不因配额上调而放松

核心理由：

1. 复杂任务更适合“多轮推进”，而不是“单轮无限变长”
2. 用户要的是“不要太早结束”，不是“永不结束”
3. 总预算显式化后，系统行为更可诊断，也更容易调优

冻结默认值：

1. 默认档位：`balanced`
2. `balanced`
   - `perTurnToolCallLimit = 16`
   - `perTurnToolStepLimit = 48`
   - `taskMaxAttempts = 5`
   - `sameToolSameArgsRetryLimit = 2`
   - `sameErrorCodeStreakLimit = 3`
3. 对照档位：
   - `conservative = 8 / 24`
   - `aggressive = 20 / 64`
4. 单轮硬上限：`20 / 64`
   - 超过硬上限必须交由下一轮 heartbeat 继续
   - 不允许继续拉长当前轮

（章节级）评审意见：[留空,用户将给出反馈]

## Alternatives

1. 直接把单轮工具调用次数大幅放大或接近无限
   - 优点：实现最简单
   - 缺点：自旋风险高，单轮时延不可控，不推荐

2. 保持现有上限不变，只依赖 heartbeat 多轮续跑
   - 优点：风险最低
   - 缺点：复杂任务仍会频繁在单轮内过早截断，用户体验改善有限

3. 单轮温和上调 + 总预算显式化（推荐）
   - 优点：兼顾稳定性与任务完成率
   - 缺点：需要同时修改 tool-loop 和 task-supervisor 状态联动

（章节级）评审意见：[留空,用户将给出反馈]

## Plan

1. 收口 tool-loop 配额配置
   - 文件：
     - `src/agent-backend/tool-loop.ts`
     - `src/config/workspace.ts` 或等价配置入口
   - 内容：
     - 将 `MAX_TOOL_CALLS_PER_TURN` / `MAX_TOOL_STEPS_TOTAL` 改为可配置
     - 给出稳态默认值（默认 `balanced = 16 / 48`）
     - 给出单轮硬上限（`20 / 64`）
   - 验收：
     - 不再是不可调硬编码

2. 区分“本轮触顶”和“总预算耗尽”
   - 文件：
     - `src/agent-backend/tool-loop.ts`
     - `src/agent-backend/types.ts`
   - 内容：
     - 返回结构中补 `continuable` 或等价信号
     - `TOOL_LOOP_LIMIT_EXCEEDED` 不再一律等价最终失败
   - 验收：
     - 调用方可据此决定“下一轮继续”还是“终态失败”

3. 接入 task-supervisor 多轮续跑
   - 文件：
     - `src/runtime/task-supervisor.ts`
   - 内容：
     - tool-loop 本轮触顶但可继续时，任务保持 `running/pending`
     - 总预算耗尽时进入 `failed`
   - 验收：
     - 复杂任务可跨多个 heartbeat tick 推进

4. 增加总尝试预算
   - 文件：
     - `src/runtime/task-types.ts`
     - `src/runtime/task-store.ts`
     - `src/runtime/task-supervisor.ts`
   - 内容：
     - 明确 `maxAttempts` / `remainingAttempts`
     - 连续触顶或连续 recoverable error 超预算后停止
   - 验收：
     - 不存在无限续跑

5. 补日志与回归锁
   - 文件：
     - `test/p5-7-r12-tool-loop-quota-strategy.test.ts`（新建）
   - 内容：
     - 复杂任务不会在单轮过早结束
     - 不会无限自旋
     - verify gate 仍有效
   - 验收：
     - 日志字段可观测
     - 测试覆盖正反两类路径

## Risks

1. 风险：只提高单轮上限，不接总预算，会放大自旋问题
   - 回滚/降级：单轮上限与总预算必须成对落地

2. 风险：状态机未区分“可继续”与“最终失败”，导致 supervisor 行为混乱
   - 回滚/降级：新增明确 continuation reason 字段

3. 风险：提高上限后单轮时延上升，影响用户体感
   - 回滚/降级：默认走 `balanced = 16 / 48`，单轮硬上限 `20 / 64`，多轮续跑优先

4. 风险：复杂任务在多轮推进时绕过 verify gate
   - 回滚/降级：completed 仍必须依赖 verify 成功

（章节级）评审意见：[留空,用户将给出反馈]

## Test Plan

1. 单测：
   - 单轮触顶但可继续
   - 总预算耗尽进入 failed
   - verify 未通过不得 completed

2. 集成：
   - `/task run -> tool-loop 触顶 -> heartbeat 继续 -> verify -> completed`
   - `/task run -> 连续 recoverable error -> 预算耗尽 -> failed`

3. 验证命令：
   - `npx tsc --noEmit`
   - `npm test`
   - `npm run docs:check`

（章节级）评审意见：[留空,用户将给出反馈]

## Observability

建议新增统一观测字段：

1. `perTurnToolCallLimit`
2. `perTurnToolStepLimit`
3. `remainingAttempts`
4. `continuationReason`
5. `budgetExhausted`
6. `verifyStatus`
7. `quotaProfile`

（章节级）评审意见：[留空,用户将给出反馈]
