# WORKSTATE 纯文本试跑报告：TK0275

生成时间：2026-03-20

## 目标

验证 `WORKSTATE` 在不改 runtime 的前提下，是否比只看 `issue/plan` 更适合恢复一张已到 `rvw` 的非轻量任务工作态。

试跑对象：

- 任务真相源：
  - `/Users/admin/GitProjects/msgcode/issues/tk0275.rvw.agent.p0.fast-feedback-execution-slice.md`
  - `/Users/admin/GitProjects/msgcode/docs/plan/pl0275.tdo.agent.0267-fast-feedback-execution-slice.md`
- WORKSTATE：
  - `/Users/admin/GitProjects/msgcode/.msgcode/workstates/tk0275.md`
- 对应实现提交：
  - `b6c12dc`

## 试跑方法

做两次恢复对照：

1. 只读取 `issue + plan`
2. 读取 `issue + plan + WORKSTATE`

观察能否稳定回答下面几类问题：

- 当前目标是什么
- 当前意图是什么
- 当前主要判断是什么
- 哪些路径已经排除
- 当前最值得继续看的文件是什么
- 下一步应从哪接

## 对照结果

### A. 只看 issue + plan

能稳定恢复的内容：

- 当前任务的高层目标：
  - 把 `0267/0268/0269` 收成今日可执行切片
- 当前执行顺序：
  - 先合同
  - 再 verify pack
  - 最后证据写回
- 高层验收：
  - 形成“改 -> 验 -> 再修 -> 证据”闭环

恢复不稳或需要重新猜的内容：

- 当前实现到底采取了哪条最小主链
- 哪些更重的方案已经被排除
- 这轮真实 touched files 是哪些
- 当前影响半径集中在哪几块
- 现在最合理的续接点到底是什么

结论：

只看 `issue + plan` 足够恢复“发生了什么”，但不足以稳定恢复“现在该以什么姿态继续”。

### B. 再加 WORKSTATE

新增稳定恢复的内容：

- 当前意图：
  - 保持 prompt 合同 + verify pack + evidence tails 这条薄链
- 当前主假设：
  - 不需要新平台，只需把合同、入口、证据字段收紧
- 已排除路径：
  - 不做测试编排平台
  - 不默认猜 e2e smoke
  - 不给生产代码加测试后门
- 当前 touched files：
  - `prompts/agents-prompt.md`
  - `src/cli/verify.ts`
  - `src/runtime/heartbeat-tick.ts`
  - 三张相关测试
- 当前影响面：
  - coding lane prompt
  - verify CLI
  - heartbeat verification evidence
- 下一步恢复点：
  - 继续挑一张真实非轻量任务，再做一次 `WORKSTATE` 试跑

结论：

加入 `WORKSTATE` 后，可以稳定恢复“为什么这样做、不要回头做什么、现在该从哪接”。

## 判断

这次试跑支持 `0259` 的核心判断：

- `WORKSTATE` 不是第二份 summary
- 它确实比纯 `issue + plan` 更适合恢复工作姿态

但这次试跑也有边界：

- 还没有经过真实 compact 后的恢复验证
- 还没有跨 session 验证
- 还没有证明它在所有任务上都值得写

所以当前更准确的结论是：

- `WORKSTATE` 已证明“有增益”
- 但还只证明到“review 边界纯文本试跑”这一层
- 还不足以推动 `0270`

## 下一步建议

下一步不做 graph/router。

先继续补第二个真实样本，最好满足至少一个条件：

- 真实 compact 前写入
- 隔一轮或跨窗口后再恢复

如果第二个样本仍然能稳定证明恢复增益，再考虑 `0259` 是否进入更强的读取接线。
