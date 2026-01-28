# E10: 定时任务（Jobs）+ 主动推送

## Goal
用户用命令配置定时任务，agent 能按计划执行并把结果推送到 DM/群（并可落到 public 链接）。

## Scope
- Job 定义：name + schedule + command/script + workspace + target(DM/群)
- 执行器：支持超时、并发限制、重试（可选）
- 输出：日志摘要 + 产物链接（public）

## Non-goals
- 不做复杂的分布式调度；2.0 只做单机稳定。

## Tasks
- [ ] Job store（本地持久化）
- [ ] 调度器（cron 或简化表达式）
- [ ] 执行隔离（allowlist 或 workspace 内脚本）
- [ ] 推送目标（DM/群）+ 错误告警策略

## Acceptance
- `/job add` 后能按时运行并推送；失败可诊断、可暂停、可重跑。

