# WORKSTATE 纯文本试跑报告：真实 Compact 样本

生成时间：2026-03-20

## 目标

补第三个样本，验证在真实 `context-policy` compact 触发前预先写好 `WORKSTATE` 时，compact 后仍然存在更清晰的恢复锚点。

这次不改 runtime，不让系统自动读取 `WORKSTATE`。

只做一件事：

- 先在临时 workspace 写入任务真相源和 `WORKSTATE`
- 再用真实 `assembleAgentContext()` 触发 compact
- 观察 compact 后 summary/window 还能留下什么
- 对照 `WORKSTATE` 还能补回什么

## 实验设置

临时工作区：

- `/var/folders/69/klm08tq10wv1px7jmz8hxcgm0000gp/T/msgcode-workstate-compact-NOcTvM`

关键文件：

- issue：
  - `/var/folders/69/klm08tq10wv1px7jmz8hxcgm0000gp/T/msgcode-workstate-compact-NOcTvM/issues/tk9300.doi.runtime.compact-workstate-sample.p1.md`
- workstate：
  - `/var/folders/69/klm08tq10wv1px7jmz8hxcgm0000gp/T/msgcode-workstate-compact-NOcTvM/.msgcode/workstates/tk9300.md`

触发方式：

- 预写 24 条长消息进 session window
- 调用真实 `assembleAgentContext()`
- 环境变量压低 budget，让 compact 必然发生

## 真实结果

来自运行结果的核心事实：

- compact 已真实触发：
  - `compactionTriggered = true`
- compact 原因：
  - `context usage 24143% >= 70% threshold`
- 窗口条数变化：
  - `beforeWindowCount = 24`
  - `afterWindowCount = 16`
- summary 已真实落盘：
  - `summaryGoalCount = 1`
- checkpoint 仍保留：
  - `状态摘要: compact 前的恢复样本`
  - `下一步: 优先读取 workstate，再判断是否继续恢复子任务`

## 对照判断

### Compact 后只看 summary / checkpoint

能保留：

- 发生过 compact
- 有一个最短 goal
- 有一个最短 nextAction

保不稳：

- 当前意图
- 当前主假设
- 已排除路径
- 当前 touched files
- 为什么下一步是这个，不是那个

### 再加预写的 WORKSTATE

能补回：

- 当前意图：
  - 先让 compact 真发生，再看 summary 之外还剩哪些恢复骨架
- 主假设：
  - summary 只能保留“发生了什么”，不擅长保留“当前恢复姿态”
- 已排除路径：
  - summary 不足以单独承担恢复骨架
  - compact 后 transcript 尾部不能天然替代工作骨架
- 下一恢复点：
  - compact 后优先读取 `WORKSTATE`，再回看 summary

## 结论

这次样本比前两次更强，因为它真的贴着 compact 发生。

结论是：

- compact 后，summary/checkpoint 仍然必要
- 但它们仍然更像“最短事实压缩面”
- `WORKSTATE` 依然更适合承接“当前姿态、排除路径、恢复入口”

换句话说：

- summary 负责保留“发生了什么”
- WORKSTATE 负责保留“现在该怎么接”

## 对 0259 / 0270 的判断

到这里，`0259` 已经有三层证据：

1. review 边界样本
2. compact 邻近样本
3. 真实 compact 触发样本

这足以证明：

- `WORKSTATE` 不是噪音文件
- 它确实有恢复增益

但我仍然不建议直接开 `0270`。

原因：

- 现在证明的是“WORKSTATE 有用”
- 还没证明“graph/router 是下一步最值钱的补强”

更稳的下一步应该是：

- 先把 `WORKSTATE` 的读取接线边界想清楚
- 仍然避免把它做成新控制层
