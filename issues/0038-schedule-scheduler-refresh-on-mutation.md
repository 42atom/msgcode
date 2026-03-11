---
id: 0038
title: schedule 变更后立即刷新 jobs 与 scheduler
status: done
owner: agent
labels: [bug, scheduler, schedule]
risk: high
scope: schedule/jobs/scheduler/runtime
plan_doc: docs/design/plan-260308-schedule-scheduler-refresh-on-mutation.md
links:
  - /Users/admin/.config/msgcode/log/msgcode.log
  - /Users/admin/.config/msgcode/cron/jobs.json
  - /Users/admin/.config/msgcode/cron/runs.jsonl
  - /Users/admin/msgcode-workspaces/smoke/ws-a/.msgcode/schedules/live-cron.json
created: 2026-03-08
due:
---

## Context

- 2026-03-08 02:51 左右，自然语言创建 `live-cron` 成功，日志出现 `Tool Bus: SUCCESS read_file`、多次 `Tool Bus: SUCCESS bash`，最终回复 `已添加每分钟发送 "live cron" 的定时任务，ID 为 live-cron`。
- 工作区 schedule 文件已落盘：`/Users/admin/msgcode-workspaces/smoke/ws-a/.msgcode/schedules/live-cron.json`。
- jobs 投影已存在：`/Users/admin/.config/msgcode/cron/jobs.json` 中有 `id: schedule:246a7f78356b:live-cron`，且 `payload.kind: chatMessage`。
- 但该任务从未执行：`/Users/admin/.config/msgcode/cron/runs.jsonl` 中 `live-cron` 记录数为 0。
- 当前 jobs 状态异常：`nextRunAtMs: null`，`lastStatus: pending`。
- 根因初判：
  - `scheduleToJob()` 把 `nextRunAtMs` 留空。
  - `JobScheduler` 只在启动或 timer tick 时计算下一次运行。
  - schedule 变更后没有主动唤醒 scheduler 重算并重新 arm timer。
  - CLI 与聊天命令各自维护一套 schedule->jobs 同步逻辑，且会覆盖其他 workspace 的 schedule 投影，存在持续漂移风险。

## Goal / Non-Goals

### Goals

- 让 `schedule -> jobs -> scheduler` 收口为一条正式主链。
- 新建/启用 schedule 后，jobs 投影里的 `nextRunAtMs` 立即可用。
- add/remove/enable/disable 后，scheduler 立即 refresh/rearm，不依赖重启或人工清理。
- CLI 与聊天命令复用同一套 schedule 投影与 refresh 逻辑。

### Non-Goals

- 不新增 polling 扫描层。
- 不用重启 bot 作为正式修复。
- 不改飞书通道与自然语言回答术。
- 不扩展新的 `at/every` 能力。

## Plan

- [x] 收集日志、jobs、runs、workspace schedule 文件证据
- [x] 创建 Plan 文档并完成 Occam Check
- [x] 新增 JobScheduler 公开 `refresh()` 入口，统一启动/热刷新链路
- [x] 收口 schedule 投影 helper，统一 CLI 与聊天命令
- [x] 在 add/remove/enable/disable 后触发 scheduler refresh
- [x] 补定向测试与真实 smoke，回填证据后关闭 issue

## Acceptance Criteria

1. 新建 schedule 后 `jobs.json` 中对应 job 的 `nextRunAtMs` 立即为非 null。
2. 不重启 msgcode，下一分钟能真实触发新建 schedule。
3. 删除 schedule 后，对应 job 投影消失，下一分钟不再追加运行记录。
4. CLI 与聊天命令对 add/remove/enable/disable 的行为一致。
5. 有可复现的测试与 smoke 证据。

## Notes

- Logs：
  - `/Users/admin/.config/msgcode/log/msgcode.log`
  - 关键证据：`2026-03-08 02:51:20` 到 `2026-03-08 02:51:39` 的 schedule 创建成功链路
- Files：
  - `/Users/admin/msgcode-workspaces/smoke/ws-a/.msgcode/schedules/live-cron.json`
  - `/Users/admin/.config/msgcode/cron/jobs.json`
  - `/Users/admin/.config/msgcode/cron/runs.jsonl`
- Code：
  - `src/config/schedules.ts`
  - `src/jobs/scheduler.ts`
  - `src/jobs/schedule-sync.ts`
  - `src/jobs/cron.ts`
  - `src/commands.ts`
  - `src/cli/schedule.ts`
  - `src/routes/cmd-schedule.ts`
- Tests：
  - `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r18-schedule-refresh-on-mutation.test.ts test/p5-7-r12-t2-scheduler-self-heal.test.ts test/p5-7-r5-2-schedule-contract.test.ts`
  - 结果：`49 pass, 0 fail`
- Smoke：
  - `./bin/msgcode restart`
  - 重启后 `jobs.json` 中 `schedule:246a7f78356b:live-cron.state.nextRunAtMs = 1772939460000`
  - `runs.jsonl` 新增：
    - `{"ts":"2026-03-08T03:11:00.003Z","jobId":"schedule:246a7f78356b:live-cron", ... ,"status":"ok"}`
  - 用户已确认 2026-03-08 11:11 +08 实际收到 `live cron`
  - `./bin/msgcode schedule remove live-cron --workspace /Users/admin/msgcode-workspaces/smoke/ws-a --json`
  - 删除后：
    - `/Users/admin/msgcode-workspaces/smoke/ws-a/.msgcode/schedules/` 为空
    - `jobs.json` 不再包含 `schedule:246a7f78356b:live-cron`
    - 2026-03-08 11:13 +08 再查 `runs.jsonl`，`live-cron` 计数仍为 `1`

## Links

- Plan: `docs/design/plan-260308-schedule-scheduler-refresh-on-mutation.md`
