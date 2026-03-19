# WORKSTATE（抗 Context Death 的工作态骨架）

## 结论

- `WORKSTATE` 不是任务真相源。
- `WORKSTATE` 不是 runtime `work capsule`。
- `WORKSTATE` 是给“下一窗口的模型”看的最小工作态骨架，用于跨窗口恢复工作姿态。
- 它只在工作态即将断裂或显著变化时更新；不是每轮聊天日志。

## 解决的问题

当前系统跨窗口时，往往只能依赖：

- `summary`
- recent window
- issue / checkpoint
- log / diff / task history

这些内容足以恢复“发生了什么”，但不足以稳定恢复：

- 当前主假设
- 已排除路径
- 当前 patch intent
- 当前最值得继续看的文件 / symbol / 测试 / trace

`WORKSTATE` 的作用就是补这层骨架。

## 分层边界

### 1. Truth Source

承担任务状态真相的仍然是：

- `issues/*.md`
- dispatch / checkpoint / artifact refs

它们回答：

- 任务是什么
- 现在处于什么状态
- 验收口径是什么

### 2. Runtime Work Capsule

runtime `work capsule` 继续负责：

- taskId
- phase
- checkpoint
- nextAction
- activeDispatch
- source stamp

它服务：

- wake
- resume
- heartbeat
- task supervisor

它回答：

- 系统下一步该怎么续跑

### 3. WORKSTATE

`WORKSTATE` 单独负责：

- current intent
- active hypothesis
- rejected hypotheses
- touched files / symbols
- impact radius
- key evidence
- next resume point

它服务：

- 模型跨窗口恢复
- 人工 handoff
- context rebuild

它回答：

- 下一窗口该以什么姿态接上

### 4. Summary

`summary` 继续存在，但只作为快速回读接口。

它不能承担：

- 工作态真相
- runtime 恢复协议
- 结构化推理骨架

## 文件位置

建议最小落点：

- `<workspace>/.msgcode/workstates/<taskId>.md`

约束：

- 不写入 `issues/`
- 不替代 runtime `work capsule`
- 不作为新的状态真相源

## 文件模板

```md
---
task: tkNNNN
updated_at: 2026-03-19T12:00:00+08:00
source_stamp: <hash>
truth_refs:
  - /abs/path/to/issue.md
  - /abs/path/to/evidence-or-dispatch
---

# Goal
一句话目标

# Current Intent
当前 patch / 当前推进意图

# Active Hypothesis
当前最主要的判断

# Rejected Hypotheses
- 已排除路径

# Touched Files
- /abs/path/to/file.ts :: SymbolName

# Impact Radius
- 受影响模块 / 调用链 / 风险面

# Key Evidence
- failing test
- logs
- trace

# Open Edges
- 未决问题

# Next Resume Point
- 下一窗口从哪接

# Short Handoff
给下一窗口的最短恢复说明
```

## 允许字段

必须尽量短，优先槽位化表达。

允许：

- 目标
- 当前意图
- 主假设
- 已排除假设
- touched files / symbols
- impact radius
- key evidence refs
- next resume point
- open edges

不鼓励：

- 长篇散文总结
- transcript 回放
- 无结构的自由发挥

## 禁止承载的内容

以下内容禁止写进 `WORKSTATE`：

- 任务文件名状态真相
- dispatch 执行状态真相
- subagent 明细状态真相
- wake 消费结果真相
- 完整 transcript
- 全量日志正文
- 机器自动推导但无证据支撑的结论

冲突时，一律以真相源为准：

- `issues/*.md`
- dispatch / checkpoint / artifact 真相
- 原始 evidence 文件

## 触发规则

### 必触发

1. 即将 compact / 切窗前
2. durable checkpoint 写盘时
3. 从 `doi -> rvw` 前

### 条件触发

4. 主假设变化
5. 关键证据新增

### 不触发

1. 每条消息后
2. 没有新信息时
3. 轻问题 / 闲聊

## 更新规则

- `WORKSTATE` 是 checkpoint 文件，不是 append-only 日志。
- 每次更新应覆盖写入当前有效骨架，而不是一直堆历史。
- 若 `source_stamp` 与底层真相不一致，应优先重建，不继续信任旧骨架。
- 当任务进入终态：
  - `dne`
  - `cand`
  - `arvd`
  可删除或归档 `WORKSTATE`，但不影响真相源。

## 与 Graph / Context Query 的关系

`WORKSTATE` 只保存恢复入口，不保存全部结构细节。

适合动态查询补足的内容包括：

- touched symbols 的依赖链
- impact radius 的扩展面
- 关键测试绑定
- 风险最高的调用路径
- 相关文件排序

因此：

- `WORKSTATE` = 恢复骨架
- graph/context query = 恢复细节

不要把整张图写死进文件。

## 读取顺序建议

模型跨窗口恢复时，建议按以下顺序读取：

1. `issues/*.md` 真相源
2. runtime `work capsule`（若当前链路需要）
3. `WORKSTATE`
4. 关键 evidence
5. summary / recent window
6. 当前请求

这样可以避免：

- 先看 prose summary，再猜任务骨架

## 最小落地顺序

1. 先有本协议
2. 再允许 agent 在关键边界写 `WORKSTATE`
3. 再让 context rebuild 优先读取它
4. 最后才接 graph/context sidecar

## 非目标

本协议不覆盖：

- persistent KV / latent state
- model-side memory continuation
- transcript continuity
- 新的 memory platform
- runtime `work capsule` 重构

## 参考

- [issues/tk0205.pss.runtime.p0.work-continuity-truth-and-recovery-foundation.md](/Users/admin/GitProjects/msgcode/issues/tk0205.pss.runtime.p0.work-continuity-truth-and-recovery-foundation.md)
- [issues/tk0239.pss.runtime.p1.work-capsule-builder-and-source-stamp.md](/Users/admin/GitProjects/msgcode/issues/tk0239.pss.runtime.p1.work-capsule-builder-and-source-stamp.md)
- [issues/tk0207.pss.runtime.p1.session-continuity-on-work-foundation.md](/Users/admin/GitProjects/msgcode/issues/tk0207.pss.runtime.p1.session-continuity-on-work-foundation.md)
- [docs/plan/pl0259.tdo.agent.anti-context-death-work-state-plan.md](/Users/admin/GitProjects/msgcode/docs/plan/pl0259.tdo.agent.anti-context-death-work-state-plan.md)
