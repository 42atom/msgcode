---
id: 0022
title: Scheduler skill + bash 主链收口
status: doing
owner: agent
labels: [feature, skills, scheduler]
risk: medium
scope: skills/runtime/prompt/schedule
plan_doc: docs/design/plan-260307-scheduler-skill-bash-mainline.md
links:
  - /Users/admin/.config/alma/skills/scheduler/SKILL.md
  - /Users/admin/GitProjects/msgcode/src/cli/schedule.ts
  - /Users/admin/GitProjects/msgcode/src/routes/cmd-schedule.ts
created: 2026-03-07
due:
---

## Context

- 当前自然语言创建 cron/schedule 时，模型会生成伪 `cron_add` 工具调用，但 msgcode 并没有对应的 LLM tool。
- 日志已经证明失败点在“入口没桥上”，不是 scheduler 引擎本身先坏：
  - `route=no-tool`
  - `agent-first chat fallback: no tools exposed`
  - 最终输出伪 `[TOOL_CALL] cron_add`
- msgcode 其实已经有正式能力：
  - `msgcode schedule add|list|remove`
  - `<workspace>/.msgcode/schedules/*.json`
  - `jobs/scheduler.ts`
- 用户已明确冻结方向：cron/schedule 不新增专用 LLM tool，走 `skill + bash`。

## Goal / Non-Goals

### Goals

- 在仓库内落一份可同步的 `scheduler` runtime skill 真相源。
- 明确 cron/schedule 的正式主链是：`scheduler skill -> bash -> msgcode schedule / schedule 文件协议`。
- 给后续 prompt 收口与真实 smoke 提供稳定入口。

### Non-Goals

- 本单不新增 `cron_add` / `schedule_add` LLM tool。
- 本单不直接改 prompt 主链。
- 本单不重构 scheduler 引擎。
- 本单不碰模型回答术。

## Plan

- [x] 创建并评审 Plan 文档：`docs/design/plan-260307-scheduler-skill-bash-mainline.md`
- [x] 新增 `src/skills/runtime/scheduler/` 真相源
- [x] 更新 `src/skills/runtime/index.json`
- [x] 补 runtime skill sync 回归锁
- [ ] 交由后续任务收口 prompt 与真实 smoke

## Acceptance Criteria

1. 仓库内存在可同步的 `scheduler` runtime skill。
2. skill 文案明确禁止发明 `cron_add`，并指向 `bash + msgcode schedule` 或文件协议。
3. `runtime-sync` 同步后，用户目录 index 中包含 `scheduler`。
4. 回归测试锁住 `scheduler` skill 的同步结果。

## Notes

### 评审发现（P1 问题）

**架构断裂** - `msgcode schedule` 与 JobScheduler 不连通：
- `msgcode schedule` CLI 写入：`<workspace>/.msgcode/schedules/*.json`
- JobScheduler 读取：`~/.config/msgcode/cron/jobs.json`
- 两套系统没有连通，创建的 schedule 永远不会被触发

### 端到端验证结果

2026-03-07 15:35 测试：
```bash
$ bash ~/.config/msgcode/skills/scheduler/main.sh add test-e2e-verification --workspace /Users/admin/GitProjects/msgcode --cron '* * * * *' --tz Asia/Shanghai --message '端到端验证测试'
已添加 schedule: test-e2e-verification

$ bash ~/.config/msgcode/skills/scheduler/main.sh list --workspace /Users/admin/GitProjects/msgcode
定时调度 (1):
  [x] test-e2e-verification
      Cron: * * * * * (Asia/Shanghai)
```

文件已写入 `workspace/.msgcode/schedules/test-e2e-verification.json`，但 `jobs.json` 中没有对应 entry，scheduler 无法触发。

### 结论

- [x] prompt 已导向 scheduler skill
- [x] runtime skill 已同步到用户目录
- [x] fake cron_add 桥接方向已改正
- [ ] 实战闭环 - 需要修复架构断裂问题

### 遗留项

需要在后续任务中解决：
1. 让 `msgcode schedule` 也写入 `jobs.json`，或
2. 让 JobScheduler 读取 workspace schedules

---

- Logs：
  - `/Users/admin/.config/msgcode/log/msgcode.log`
  - `2026-03-07 15:15:07` 这一轮中，cron 创建失败是 `route=no-tool`，不是 scheduler 宕机。
- Code：
  - `/Users/admin/GitProjects/msgcode/src/cli/schedule.ts`
  - `/Users/admin/GitProjects/msgcode/src/config/schedules.ts`
  - `/Users/admin/GitProjects/msgcode/src/jobs/scheduler.ts`

## Links

- Plan: `docs/design/plan-260307-scheduler-skill-bash-mainline.md`
