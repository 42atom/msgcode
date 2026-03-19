# WORKSTATE 读回试跑报告：Compact 后 Heartbeat 续跑样本

生成时间：2026-03-20

## 目标

补一条更完整的样本，验证这条链是否已经成立：

- 先有 `WORKSTATE`
- 再发生真实 compact
- 然后进入 `heartbeat` 续跑
- 续跑时能读回 `WORKSTATE`

这次不再只验证“写下 `WORKSTATE` 有价值”，而是验证：

- `WORKSTATE` 已经进了现役读回主链

## 实验设置

临时工作区：

- `/var/folders/69/klm08tq10wv1px7jmz8hxcgm0000gp/T/msgcode-workstate-readback-6EMuZp/workspace`

关键对象：

- taskId：
  - `tk9301`
- issue：
  - `issues/tk9301.doi.runtime.workstate-readback-sample.p1.md`
- workstate：
  - `.msgcode/workstates/tk9301.md`

`WORKSTATE` 核心内容：

- Goal：验证 compact 之后，task/heartbeat 续跑能读回 `WORKSTATE`
- Current Intent：先恢复当前工作骨架，再判断是否继续推进子任务
- Rejected Hypotheses：只靠 summary 就足够恢复当前姿态
- Next Step：优先读取 `WORKSTATE`，再检查 summary/window

触发方式：

1. 先写入 24 条长消息
2. 用真实 `assembleAgentContext()` 触发一次 `task` 链 compact
3. 再用真实 `assembleAgentContext()` 触发一次 `heartbeat` 续跑
4. 最后用真实 `buildDialogPromptWithContext()` 观察最终提示词顺序

## 真实结果

### 第一次：task 链 compact

- `compactionTriggered = true`
- `compactionReason = context usage 54806% >= 70% threshold`
- `beforeWindowCount = 24`
- `afterWindowCount = 16`
- `summaryGoalCount = 1`

这说明：

- compact 主链真实发生
- compact 后 summary/window 已被重写

### 第二次：heartbeat 续跑

- `source = heartbeat`
- `workstateLoaded = true`
- `summaryLoaded = true`
- `checkpointLoaded = true`

`WORKSTATE` 读回片段开头为：

```md
# Goal
验证 compact 之后，task/heartbeat 续跑能读回 WORKSTATE。

# Current Intent
先恢复当前工作骨架，再判断是否继续推进子任务。
```

这说明：

- `heartbeat` 续跑已经不只是看到 `summary/checkpoint`
- 它确实读回了 `<workspace>/.msgcode/workstates/<taskId>.md`

### 最终提示词顺序

来自真实 `buildDialogPromptWithContext()` 的位置结果：

- `workstateIndex = 0`
- `summaryIndex = 203`
- `windowIndex = 420`
- `userIndex = 4630`
- `ordered = true`

这说明最终顺序已经是：

1. `WORKSTATE`
2. `summary`
3. `window`
4. 当前 prompt

## 对照判断

这条样本比 `0276` 更强，因为它不再只是“证明 WORKSTATE 有价值”。

它证明的是：

- `WORKSTATE` 已经进了读回主链
- 进入点是现有 `context-policy`
- 没有新增 manager / selector / router
- 读回边界仍然很窄，只在有 `taskId` 的续跑链发生

## 结论

到这里，可以确认两件事：

1. `0259` 的“工作态骨架”不是空设计  
   它已经有写入协议、试跑样本、真实读回主链。

2. `0277` 的“最薄读回接线”已经成立  
   `WORKSTATE` 能在 compact 后的 `heartbeat` 续跑里被读回，并按预期排在 `summary` 前。

## 对下一步的判断

现在仍然不建议直接开 `0270`。

原因没变：

- 现在证明的是 `WORKSTATE` 主链已经成立
- 还没证明 graph/router 是更高价值的下一层

更稳的下一步应该是：

- 再做一次真实自举任务样本
- 看模型在真实续跑里是否会主动利用 `WORKSTATE`
- 若没有明显偏差，就先把 `0259 / 0277` 收口到 `pss`
