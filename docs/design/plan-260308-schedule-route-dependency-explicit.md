# Plan: Schedule Route 依赖显式化

## Problem

当前 schedule 系统对 route/chat 绑定的依赖是"隐式前提"：
- 用户可以创建 schedule，但系统可能永远不会投递
- 失败是静默的（warning），不是显式的错误
- 用户无法从 list 输出中看出 schedule 是否可投递

**断裂点**：
- `syncScheduleToJobs` 找不到 route 时只返回 warning
- schedule 文件创建成功，但 jobs.json 中的投影无效
- 用户以为创建成功，实际永远不会触发

## Occam Check

### 1. 不加这次改动，系统具体坏在哪？

**待收集证据**，但初步分析：
- 用户在未绑定 route 的 workspace 创建 schedule
- `syncScheduleToJobs` 返回 warning，但 schedule 文件已创建
- jobs.json 中可能没有投影，或投影无效
- scheduler 不会触发该 schedule
- 用户永远收不到提醒，但不知道原因

### 2. 用更少的层能不能解决？

**推荐方案：不新增层，显式化现有逻辑**

选项：
- **方案 A**：未绑定 route 时禁止创建，直接失败
  - 优点：简单清晰，无半成功状态
  - 缺点：用户需要先 bind 才能创建

- **方案 B**：允许创建，但显式标记为 unroutable
  - 优点：用户可以提前创建，bind 后自动可用
  - 缺点：需要新增状态字段，list 需要显示状态

**推荐：方案 A**
- 理由：schedule 的本质是"定时投递"，无法投递的 schedule 没有存在意义
- 用户动机：创建 schedule 就是为了收到提醒，不是占位

### 3. 这个改动让主链数量变多了还是变少了？

- 主链数量不变（仍是一条：add -> sync -> jobs -> scheduler）
- 但消除了"半成功隐式状态"

## Decision

**选型：方案 A - 未绑定 route 时禁止创建**

核心理由：
1. schedule 的本质是"定时投递"，无法投递的 schedule 没有意义
2. warning 会掩盖问题，让用户误以为创建成功
3. 显式失败比静默失败更好

**不选方案 B 的理由**：
- 新增 unroutable 状态会增加状态空间
- 用户仍需要理解"为什么创建了却不触发"
- list 显示状态会增加认知负担

## Plan

### 步骤 1：收集证据

**检查链**：
- `src/cli/schedule.ts` - `syncScheduleToJobs` / `findRouteByWorkspace`
- `src/config/schedules.ts` - `scheduleToJob` / `mapSchedulesToJobs`
- `src/routes/cmd-schedule.ts` - `handleScheduleAddCommand` / `syncScheduleToJobs`
- `src/jobs/scheduler.ts` - dispatch 逻辑

**记录**：
- 有 route 时会发生什么
- 无 route 时会发生什么

### 步骤 2：统一错误处理

**改动文件**：
- `src/cli/schedule.ts` - add 命令检查 route，无 route 时失败
- `src/routes/cmd-schedule.ts` - 同样逻辑

**错误码**：
- 新增：`SCHEDULE_ROUTE_NOT_FOUND` 或复用 `SCHEDULE_WORKSPACE_NOT_FOUND`

### 步骤 3：更新 help-docs 合同

**改动文件**：
- `src/cli/schedule.ts` - getScheduleAddContract 错误码
- `test/p5-7-r5-3-help-regression-lock.test.ts` - 测试

### 步骤 4：测试

**新增测试**：
- 有 route：schedule add 成功并可执行
- 无 route：schedule add 失败，错误信息明确

### 步骤 5：真机 smoke

- 已绑定 workspace：add 成功
- 未绑定 workspace：add 失败

## Risks

### 主要风险

1. **破坏现有用户工作流**
   - 风险：用户可能已经在未绑定 route 的 workspace 创建了 schedule
   - 缓解：错误信息明确说明需要先 bind

2. **CLI 与聊天命令不一致**
   - 风险：一边失败，一边 warning
   - 缓解：共用同一套检查逻辑

## Alternatives

### 方案 B：允许创建，显式标记 unroutable

**描述**：
- 允许创建，但 jobs.json 中标记为 disabled 或 unroutable
- list 输出显示状态

**决策**：本轮不采用，增加状态空间

## Test Plan

1. CLI 测试：
   - 有 route：add 成功
   - 无 route：add 失败

2. 聊天命令测试：
   - 同上

3. 回归测试：
   - 现有测试不受影响

## Observability

- 错误信息明确说明需要先 bind route
- list 输出可显示 route 绑定状态（可选）

---

**评审意见**：[留空，用户将给出反馈]
