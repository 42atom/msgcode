---
id: 0025
title: Schedule Route 依赖显式化 - 禁止"创建成功但永不投递"的半成功状态
status: doing
owner: agent
labels: [feature, schedule, architecture]
risk: medium
scope: src/cli/schedule.ts, src/config/schedules.ts, src/routes/cmd-schedule.ts
plan_doc: docs/design/plan-260308-schedule-route-dependency-explicit.md
links:
  - /Users/admin/GitProjects/msgcode/issues/0022-scheduler-skill-bash-mainline.md
  - /Users/admin/GitProjects/msgcode/issues/0023-schedule-entry-unification.md
created: 2026-03-08
due:
---

## Context

- Issue 0022 完成了 `msgcode schedule` CLI 与聊天命令的双入口统一
- Issue 0023 修复了 job 结构不一致和 workspace 解析语义偏离问题
- 当前遗留问题：schedule 对 route/chat 绑定的依赖是"隐式前提"，未绑定时会进入"创建成功但永不投递"的半成功状态

## Goal / Non-Goals

### Goals
- 查清 schedule 投影到 jobs 时对 route/chat 绑定的真实依赖
- 明确产品规则：未绑定 route 时是否允许创建 schedule
- CLI 与 `/schedule` 聊天命令统一采用同一套规则
- 补观测与合同，让"可投递"和"不可投递"状态都可观测

### Non-Goals
- 不重构 scheduler 引擎
- 不改 memory/thread/task/event-queue
- 不新增新的 LLM tool
- 不碰 prompt 分层实验

## Plan

- [x] 创建 issue + plan 文档
- [x] 先拿证据（查完整链，记录有/无 route 时的行为）
- [x] 做规则决策（选择方案 A）
- [x] 统一 CLI 与聊天命令
- [x] 补观测与合同（测试更新）
- [x] 测试
- [ ] 真机 smoke

## Occam Check

### 1. 不加这次改动，系统具体坏在哪？

**证据（2026-03-08）**：

**CLI (`src/cli/schedule.ts` line 398-418)**：
```typescript
// 写入文件（先写，后同步）
await writeFile(schedulePath, JSON.stringify(schedule, null, 2), "utf-8");

// 同步到 jobs.json
const syncResult = syncScheduleToJobs(workspacePath, scheduleId, true);
if (syncResult.warning) {
  warnings.push(createScheduleDiagnostic("SCHEDULE_SYNC_WARNING", syncResult.warning));
}

// 即使 sync 失败（无 route），仍返回 pass
const envelope = createEnvelope(command, startTime, "pass", data, warnings, errors);
```

**聊天命令 (`src/routes/cmd-schedule.ts` line 277-296)**：
```typescript
// 写入文件
writeFileSync(schedulePath, JSON.stringify(schedule, null, 2), "utf-8");

// 同步到 jobs.json
const syncResult = await syncScheduleToJobs(workspacePath, options.chatId);
if (syncResult.warning) {
  resultMessage += `\n  警告：${syncResult.warning}`;
}

// 仍返回 success: true
return { success: true, message: resultMessage };
```

**问题**：
1. schedule 文件创建成功，但 jobs.json 无投影
2. 用户收到"成功"消息，但 schedule 永远不会触发
3. warning 掩盖了产品语义缺失

### 2. 用更少的层能不能解决？

**方案 A：无 route 时禁止创建（推荐）**
- 在写入文件前检查 route
- 无 route 时直接失败，不写文件
- 错误信息明确说明需要先 bind

**方案 B：允许创建，但显式标记为 unroutable**
- 需要新增状态字段
- list 需要显示状态
- 增加状态空间

**决策：方案 A** - 更简单，无半成功状态

### 3. 这个改动让主链数量变多了还是变少了？

- 主链数量不变（仍是一条：check route -> add -> sync -> jobs -> scheduler）
- 但消除了"半成功隐式状态"

## Acceptance Criteria

1. route 依赖不再是隐式前提
2. 无 route 时不再出现"表面创建成功、实际永不投递"的半成功状态
3. CLI 与聊天命令在 route 规则上完全一致
4. help/错误码/测试锁住新口径

## Notes

### 已知坑

1. 不要用 warning 继续掩盖产品语义缺失
2. 不要新增 fallback 或恢复层去补一条本该显式失败/显式标记的主链
3. 关键不是"尽量让创建成功"，而是"让成功和失败都真实可见"
4. 别顺手扩到 workspace 自动绑定策略

## Links

- Issue 0022: Scheduler skill + bash 主链收口
- Issue 0023: Schedule 域双入口合同统一
- Plan: docs/design/plan-260308-schedule-route-dependency-explicit.md
