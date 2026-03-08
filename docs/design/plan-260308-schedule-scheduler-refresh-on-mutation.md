# Plan: schedule 变更后立即刷新 jobs 与 scheduler

Issue: 0038

## Problem

当前 schedule 创建链已经能成功写入 workspace 文件与 jobs 投影，但新增任务仍可能永久不触发。现场证据已经确认：`live-cron` 的 schedule 文件和 `jobs.json` 投影都存在，`payload.kind` 也是正确的 `chatMessage`，但 `runs.jsonl` 中没有任何运行记录，`nextRunAtMs` 长期停留在 `null`，直到人工重启或其他动作才可能恢复。根因不在单点，而在主链断裂：`scheduleToJob()` 不初始化 `nextRunAtMs`，`JobScheduler` 只在启动或 tick 时补算，schedule mutation 后也没有显式唤醒 scheduler 重排 timer。

## Evidence

- `msgcode.log`
  - 2026-03-08 02:51 左右，自然语言创建 `live-cron` 成功，出现 `Tool Bus: SUCCESS read_file`、多次 `Tool Bus: SUCCESS bash`，最终回复 `已添加每分钟发送 "live cron" 的定时任务，ID 为 live-cron`。
- Workspace file
  - `/Users/admin/msgcode-workspaces/smoke/ws-a/.msgcode/schedules/live-cron.json` 已存在。
- Jobs projection
  - `/Users/admin/.config/msgcode/cron/jobs.json` 存在 `schedule:246a7f78356b:live-cron`，且 `payload.kind = chatMessage`。
  - 同一条 job 的 `state.nextRunAtMs = null`，`state.lastStatus = pending`。
- Runs
  - `/Users/admin/.config/msgcode/cron/runs.jsonl` 中 `live-cron` 数量为 0。

## Occam Check

- 不加它，系统具体坏在哪？
  schedule 明明创建成功，但因为 `nextRunAtMs` 为空且 scheduler 没被唤醒，任务会永久不触发。
- 用更少的层能不能解决？
  能。新增 scheduler `refresh()` 公开入口，并在 schedule mutation 后立即调用；不新增 polling 层，不靠重启。
- 这个改动让主链数量变多了还是变少了？
  变少了。把现在分裂的 `schedule 写文件 / jobs 投影 / scheduler 定时器` 收成一条 `schedule mutation -> jobs projection -> scheduler refresh` 主链。

## Decision

采用“单一投影 helper + JobScheduler.refresh() + 现有 daemon 进程信号唤醒”方案：

1. `scheduleToJob()` 在创建投影时就计算 `nextRunAtMs`，禁止新 job 以 `null` 常态落盘。
2. `JobScheduler` 新增公开 `refresh()`，职责是重新读取 jobs、校验 route、重算 `nextRunAtMs`、重新 arm timer。
3. CLI 与聊天命令都复用同一个 workspace 级 schedule 投影 helper，避免两套逻辑继续漂移。
4. 聊天命令在 bot 进程内直接调 scheduler refresh；CLI 在独立进程里通过现有 pidfile 找到 daemon，并发送一次 refresh signal，不新增 polling。

## Alternatives

### 方案 A：新增轮询层扫描 jobs.json

- 优点：CLI 不需要显式通知 scheduler。
- 缺点：新增常驻扫描层，掩盖主链断裂，不符合本轮“单一主链”要求。

### 方案 B：只修 `nextRunAtMs`

- 优点：改动最小。
- 缺点：已挂起的旧 timer 不会自动提前，新 schedule 仍可能等不到下一次重排。

### 方案 C：只在 mutation 后唤醒 scheduler

- 优点：看起来更直接。
- 缺点：如果 jobs 投影仍写出 `nextRunAtMs = null`，就只是把半状态更快暴露出去。

推荐：方案 D，即“初始化 `nextRunAtMs` + refresh/rearm + 单一投影 helper”一起收口。

## Plan

1. 修 `schedule -> job` 投影
- 文件：
  - `src/config/schedules.ts`
  - `src/jobs/cron.ts`
- 改动：
  - `scheduleToJob()` 直接计算 `nextRunAtMs`
  - enabled schedule 映射失败时返回真实错误，不再静默吞掉
- 验收点：
  - add/enable 后 `jobs.json` 里的新 job `nextRunAtMs` 非 null

2. 新增 scheduler refresh 主链
- 文件：
  - `src/jobs/scheduler.ts`
  - `src/commands.ts`
  - `src/runtime/singleton.ts`
- 改动：
  - `JobScheduler.refresh()`
  - daemon 注册 refresh signal，收到后执行 `jobScheduler.refresh()`
- 验收点：
  - 不重启 daemon，schedule mutation 后 timer 会立即重排

3. 收口 schedule mutation helper
- 文件：
  - `src/jobs/schedule-sync.ts`
  - `src/cli/schedule.ts`
  - `src/routes/cmd-schedule.ts`
- 改动：
  - workspace 级投影 helper 只替换当前 workspace 的 `schedule:*` jobs
  - add/remove/enable/disable 全部复用同一套投影与 refresh 逻辑
- 验收点：
  - CLI 与聊天命令行为一致
  - 不再误删其他 workspace 的 schedule 投影

4. 测试与 smoke
- 文件：
  - `test/p5-7-r12-t2-scheduler-self-heal.test.ts`
  - `test/p5-7-r5-2-schedule-contract.test.ts`
  - 必要时新增 schedule refresh 专项锁
- 验收点：
  - add/remove/enable/disable 都会触发 refresh
  - 真实 smoke 能看到 `runs.jsonl` 追加 `live-cron`

## Risks

1. CLI 是独立进程，无法直接访问 daemon 内存里的 scheduler。
回滚/降级：使用现有 pidfile + signal 唤醒 daemon，不引入新的控制面。

2. schedule 投影 helper 如果继续按“删除全部 schedule:* 再重建当前 workspace”实现，会误删其他 workspace 的任务。
回滚/降级：按 workspace hash 只替换当前 workspace 的 schedule job 前缀。

3. signal 到达时若 scheduler 正在 tick，可能出现 timer 重排竞态。
回滚/降级：refresh 只做幂等重算与 re-arm，保持最后一次 arm 生效。

## Rollback

- 回退 `JobScheduler.refresh()`、signal handler 和 schedule projection helper。
- 恢复到当前“启动/tick 时补算”的行为，但保留证据并继续标记 issue 未解决。

## Test Plan

- `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r12-t2-scheduler-self-heal.test.ts test/p5-7-r5-2-schedule-contract.test.ts`
- 如新增专项锁，再补相应 test 文件
- 真实 smoke：
  - 创建 `live-cron`
  - 检查 `jobs.json` 中 `nextRunAtMs`
  - 等下一分钟确认 `runs.jsonl` 与真实投递
  - 删除 `live-cron`
  - 再等下一分钟确认不再追加运行

## Observability

- `JobScheduler.refresh()` 打日志：
  - `jobCount`
  - `nextWakeAtMs`
  - `refreshSource`
- schedule mutation helper 至少记录：
  - `workspacePath`
  - `scheduleId`
  - `jobId`
  - `refreshMode`

## Result

已按计划完成：

1. `scheduleToJob()` 现在在投影时直接计算 `nextRunAtMs`，不再把新 job 以 `null` 落盘。
2. `JobScheduler.start()` 与热更新统一走 `refresh()`，CLI 通过 pidfile + `SIGUSR2` 唤醒 daemon，聊天命令直接刷新本进程 scheduler。
3. 新增 `src/jobs/schedule-sync.ts`，CLI 与聊天命令都只替换当前 workspace 的 `schedule:<workspaceHash>:` 投影，不再误删其他 workspace 的 schedule jobs。
4. 真机 smoke 证据：
   - 2026-03-08 11:11 +08，`live-cron` 在不重启二次补救的前提下成功触发，`runs.jsonl` 记录 `status:"ok"`。
   - 用户已确认刚才真实收到消息。
   - 2026-03-08 11:11:44 +08 删除 `live-cron` 后，schedule 文件和 jobs 投影都消失；到 11:13 +08，`runs.jsonl` 计数仍保持 1，没有继续追加。

（章节级）评审意见：[留空，用户将给出反馈]
