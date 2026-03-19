# 任务单：Tool Loop 配额策略与多轮续跑收口

## 结论

本轮不是把工具次数改成无限。  
本轮只做一件事：让复杂任务“不容易提前结束”，但仍有明确预算与终止条件。

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
4. 单轮硬上限：
   - `perTurnToolCallLimit <= 20`
   - `perTurnToolStepLimit <= 64`
   - 超过后必须交由下一轮 heartbeat 继续，不准继续拖长当前轮

## 唯一真相源

- Plan：`docs/plan/pl0007.dne.agent.tool-loop-quota-strategy.md`
- Issue：`docs/plan/pl0007.dne.agent.tool-loop-quota-strategy.md`
- Task：`docs/archive/tasks/p5-7-r12-t8-tool-loop-quota-strategy.md`
- Dispatch：`AIDOCS/design/dispatch-260306-tool-loop-quota-strategy.md`

若实现过程发现历史文档口径冲突，以 Issue + Plan 当前内容为准。

## 本轮范围

必须实现：

1. tool-loop 单轮上限改为可配置
2. 默认走 `balanced = 16 / 48`
3. 区分“本轮触顶但任务可继续”与“总预算耗尽终态失败”
4. task-supervisor 接住“本轮触顶可继续”的信号，交由 heartbeat 下一轮继续
5. 增加总尝试预算，防止无限续跑
6. 保持 verify 仍是完成闸门
7. 补回归锁与日志字段

建议涉及文件：

1. `src/agent-backend/tool-loop.ts`
2. `src/agent-backend/types.ts`
3. `src/runtime/task-supervisor.ts`
4. `src/runtime/task-types.ts`
5. `src/config/workspace.ts`（若采用配置化）
6. `test/p5-7-r12-tool-loop-quota-strategy.test.ts`（新建）

## 非范围 / 禁止扩 scope

本轮禁止实现：

1. 无限工具调用
2. 多代理协作
3. 新 provider 适配
4. 重写 tmux 链路
5. 改 verify 规则本身

## 实现顺序

1. 先把单轮上限配置化
   - 仍保留硬 cap
   - 默认走 `balanced = 16 / 48`
   - 单轮硬上限不超过 `20 / 64`

2. 再把 tool-loop 结果语义拆开
   - 本轮触顶但可继续
   - 总预算耗尽

3. 再改 task-supervisor
   - 本轮触顶时，不直接 failed
   - 交给 heartbeat 下一轮继续

4. 最后补总预算与回归锁
   - 超预算必须终止
   - verify 仍必须成功才能 completed

## 硬验收

1. 单轮上限不再是不可调硬编码
2. 复杂任务本轮触顶后可下一轮继续
3. 系统存在明确总预算，超预算会终止
4. verify 仍然是 completed 闸门
5. 日志可观察：
   - quotaProfile
   - perTurnToolCallLimit
   - perTurnToolStepLimit
   - remainingAttempts
   - continuationReason
   - budgetExhausted
6. 三门通过：
   - `npx tsc --noEmit`
   - `npm test`
   - `npm run docs:check`
7. 无新增 `.only/.skip`

## 已知坑

1. 不要把“更敢申请工具”做成“无限申请工具”
2. 不要只提高单轮上限，不做总预算
3. 不要让复杂任务绕过 verify gate
4. 不要把所有复杂度塞进单轮；多轮续跑优先
5. 不要超过冻结硬上限 `20 / 64`

## 交付格式

执行完成后，回传必须使用以下结构：

任务：Tool Loop 配额策略与多轮续跑收口
原因：
- 当前固定上限会让复杂任务过早结束
- 用户希望更敢用工具，但不能无限自旋
过程：
- 配置化单轮上限并温和上调
- 区分本轮触顶与总预算耗尽
- task-supervisor 接入多轮续跑
- 保持 verify gate
- 补回归锁与日志字段
结果：
- 复杂任务不容易提前结束
- 系统仍有明确预算，不会无限续跑
- verify 仍然控制 completed
验证：
- 列出三门命令与关键输出
- 列出至少一条“本轮触顶后下一轮继续”的证据
- 列出至少一条“总预算耗尽终态失败”的证据
风险 / 卡点：
- 说明是否存在单轮时延明显上升
- 说明是否仍有旧入口绕过预算语义
后续：
- 若稳定，再评估是否继续微调默认上限

## 给执行同学的一句话

用户要的是“别太早结束”，不是“永不结束”；用多轮续跑和显式预算解决，不要用无限工具调用偷懒。
