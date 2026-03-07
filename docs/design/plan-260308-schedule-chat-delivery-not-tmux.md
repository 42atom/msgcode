# Plan: Schedule 聊天投递不应走 tmux

## Problem

`delivery.mode=reply-to-same-chat` 的 schedule 任务被错误投递到 tmux 通道：
- schedule 文件创建正确：`delivery.mode = reply-to-same-chat`
- jobs.json 投影已创建
- 到点触发执行，但失败：`TMUX_SESSION_DEAD`

用户收到："tmux 会话未运行，请先发送 /start"

## Occam Check

### 1. 不加这次改动，系统具体坏在哪？

**证据**：
- schedule 已创建、已触发
- 但因 `TMUX_SESSION_DEAD` 永远发不出去
- `reply-to-same-chat` 本应直接走聊天通道

**问题**：chat delivery 被错误绕到 tmux

### 2. 用更少的层能不能解决？

**推荐方案**：修正 schedule → job 投影逻辑

选项：
- **方案 A**：修 scheduleToJob 投影（推荐）
  - 优点：修正真相源映射，最小改动
  - `reply-to-same-chat` 直接映射到 chat delivery

- **方案 B**：新增投递选择层
  - 风险：引入新中间层，不符合最小原则

**推荐：方案 A** - 修正映射，不新增层

### 3. 这个改动让主链数量变多了还是变少了？

- 主链数量不变
- 让 chat delivery 直接走 chat，不再绕到 tmux

## Decision

**选型：修正 schedule → job 投影逻辑**

核心理由：
1. `reply-to-same-chat` 语义明确：回到原会话
2. 现有映射错误把它变成了 tmuxMessage
3. 最小改动原则

## Plan

### 步骤 1：查清根因

**检查代码**：
- `src/config/schedules.ts` - `syncScheduleToJobs()`
- `src/jobs/types.ts` - Job / JobPayload 定义
- `src/jobs/scheduler.ts` - JobScheduler 执行逻辑

**根因**：`syncScheduleToJobs()` 中 `reply-to-same-chat` 被错误映射到 `tmuxMessage`

### 步骤 2：修复投影

**改动文件**：`src/config/schedules.ts`

修正 `delivery.mode` 映射逻辑：
- `reply-to-same-chat` → 正确的 chat delivery 语义
- 不再绑定 tmux session

### 步骤 3：修复执行

**改动文件**：`src/jobs/scheduler.ts`

确保 scheduler 执行时：
- 识别 chat delivery 类型
- 直接走聊天通道
- 不触发 tmux session 检查

### 步骤 4：测试

**改动文件**：新增/更新测试

**验收点**：
- `reply-to-same-chat` schedule → job 正确映射
- scheduler 执行时不走 tmux

### 步骤 5：真机验证

- 重建 `cron-live` schedule
- 等下一次触发
- 验证：
  1. runs.jsonl 中 status=ok
  2. 不再 TMUX_SESSION_DEAD
  3. 飞书收到 cron live

## Risks

### 主要风险

1. **旧 tmuxMessage 场景被误伤**
   - 风险：修改影响其他 tmux 投递
   - 缓解：只改 `reply-to-same-chat` 分支

2. **历史 job 兼容**
   - 风险：已存在的 job 结构
   - 缓解：新 schedule 不再产生错误映射

## Test Plan

1. 单元测试：
   - `reply-to-same-chat` → 正确 job payload
   - scheduler 执行时识别 delivery 类型

2. 集成测试：
   - schedule 触发后走正确投递通道

## Observability

- 日志：`JobScheduler: executing chat delivery`（不再 tmux）
- runs.jsonl：`status=ok`

---

**评审意见**：[留空,用户将给出反馈]
