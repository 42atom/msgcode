# WORKSTATE 纯文本试跑报告：TK0246（Compact 邻近样本）

生成时间：2026-03-20

## 目标

补第二个 `WORKSTATE` 试跑样本，验证它在 `compaction / session rebuild` 语境下，是否同样比只看 `issue + plan + test` 更适合恢复工作姿态。

试跑对象：

- 任务真相源：
  - `/Users/admin/GitProjects/msgcode/issues/tk0246.pss.runtime.p1.session-continuity-rebuild-bdd-lock.md`
  - `/Users/admin/GitProjects/msgcode/docs/plan/pl0206.pss.runtime.work-vitals-session-bdd-design.md`
  - `/Users/admin/GitProjects/msgcode/test/p7-tk0246-session-continuity-foundation.test.ts`
- WORKSTATE：
  - `/Users/admin/GitProjects/msgcode/.msgcode/workstates/tk0246.md`

边界说明：

- 这不是 runtime 在真实 compact 边界自动写出的文件
- 这是一个“compact 邻近样本”
- 它的价值是验证：在 session/compact 相关任务里，`WORKSTATE` 是否仍然提供恢复增益

## 试跑方法

同样做两次恢复对照：

1. 只读取 `issue + plan + test`
2. 读取 `issue + plan + test + WORKSTATE`

观察能否稳定恢复：

- 当前主判断
- 哪些假设已经被排除
- compaction 场景下真相优先级如何排序
- 下一步如果继续推进，应从哪接

## 对照结果

### A. 只看 issue + plan + test

能恢复的内容：

- 这张单锁的是 session continuity 边界
- work continuity 比 session continuity 更基础
- compaction 后仍然要能续跑
- 测试已经覆盖：
  - transcript 缺失
  - truth first
  - compaction 后恢复

恢复不够稳的内容：

- 当前主线真正坚持的恢复姿态是什么
- 哪些错误路线已经被排除
- 现在最需要守住的“不要越界”边界是什么
- 如果继续推进这条线，下一步最该补的真实证据是什么

结论：

只看真相源，能恢复“验收锁住了什么”，但不够稳定地恢复“这条线现在最重要的判断和下一步动作”。

### B. 再加 WORKSTATE

新增稳定恢复的内容：

- 当前意图：
  - 锁住 `session` 只是增益层，不能抢 `work truth`
- 主假设：
  - compaction 场景下，恢复锚点仍然必须是 `work truth + work capsule`
- 已排除路径：
  - 不先回放 transcript
  - 不让 summary 抢真相
  - 不让口头完成覆盖文件真相
- 影响面：
  - session rebuild
  - compaction aftercare
  - truth priority
- 下一步恢复点：
  - 需要一条真实长任务，在 compact 前写出 `WORKSTATE` 再恢复

结论：

在 `compact/session` 语境下，`WORKSTATE` 同样有恢复增益，而且增益点不在“多记事实”，而在“把当前边界判断钉死”。

## 判断

第二个样本支持了 `0259` 的进一步判断：

- `WORKSTATE` 的价值不只出现在代码修复任务
- 它在恢复边界复杂、容易被 summary/transcript 带偏的任务上更有意义

但门槛仍然没有完全过线：

- 还没有真实 runtime 在 compact 前自动或半自动写出 `WORKSTATE`
- 还没有跨一次真实用户会话恢复来证明收益

所以当前最准确的结论是：

- `0259` 已有两个正样本
- `0270` 仍不应启动
- 下一步应优先补一条真实 compact 前样本，而不是做 graph/router

## 下一步建议

继续 `0259` 时，目标只剩一个高价值样本：

- 选一条真实长任务
- 在 compact 前按协议落一份 `WORKSTATE`
- compact 后再做恢复对照

如果这条样本也成立，再讨论 `WORKSTATE` 是否值得进更正式的读取接线。
