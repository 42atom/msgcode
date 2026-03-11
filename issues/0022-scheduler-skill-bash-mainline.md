---
id: 0022
title: Scheduler skill + bash 主链收口
status: done
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
- [x] 收口 prompt 与真实 smoke
- [x] 修复架构断裂：schedule add/remove/enable/disable 同步写入 jobs.json

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

### 修复方案（方案 A）

**真相源 + 投影模式**：
- 真相源：`<workspace>/.msgcode/schedules/*.json`
- 运行时投影：`~/.config/msgcode/cron/jobs.json`
- 同步时机：`add` / `remove` / `enable` / `disable`

**修改文件**：
- `src/cli/schedule.ts`：add/remove/enable/disable 同步写入 jobs.json

### 端到端验证结果（修复后）

**2026-03-08 00:00 测试**：
```bash
# add 同步到 jobs.json
$ npx msgcode schedule add test-sync2 --workspace /Users/admin/msgcode-workspaces/game01 --cron '* * * * *' --tz Asia/Shanghai --message '同步测试 2'
已添加 schedule: test-sync2

# jobs.json 中出现对应 entry
$ cat ~/.config/msgcode/cron/jobs.json | grep test-sync2
"id": "schedule:4e59dd76398e:test-sync2"
"enabled": true

# remove 同步删除
$ npx msgcode schedule remove test-sync2 --workspace /Users/admin/msgcode-workspaces/game01
已删除 schedule: test-sync2

# jobs.json 中 entry 消失
$ cat ~/.config/msgcode/cron/jobs.json | grep -c test-sync2
0

# enable/disable 同步
$ npx msgcode schedule disable test-disable --workspace /Users/admin/msgcode-workspaces/game01
已禁用 schedule: test-disable
$ cat ~/.config/msgcode/cron/jobs.json | grep -A1 test-disable
"enabled": false

# 调度器实际触发
$ tail ~/.config/msgcode/cron/runs.jsonl
{"ts":"2026-03-07T16:03:00.002Z","jobId":"schedule:4e59dd76398e:trigger-test",...,"status":"error","errorCode":"TMUX_SESSION_DEAD"}
{"ts":"2026-03-07T16:04:00.002Z","jobId":"schedule:4e59dd76398e:trigger-test",...,"status":"error","errorCode":"TMUX_SESSION_DEAD"}
```

### 结论

- [x] prompt 已导向 scheduler skill
- [x] runtime skill 已同步到用户目录
- [x] fake cron_add 桥接方向已改正
- [x] 实战闭环 - schedule add/remove/enable/disable 同步到 jobs.json
- [x] 调度器实际触发（TMUX_SESSION_DEAD 是预期错误，目标会话未运行）

### 遗留项

无 - 主链已打通

## Links

- Plan: `docs/design/plan-260307-scheduler-skill-bash-mainline.md`
