---
id: 0023
title: Schedule 域双入口合同统一
status: done
owner: agent
labels: [feature, refactoring, schedule]
risk: medium
scope: src/cli/schedule.ts, src/routes/cmd-schedule.ts
plan_doc: docs/design/plan-260308-schedule-entry-unification.md
links:
  - /Users/admin/GitProjects/msgcode/issues/0022-scheduler-skill-bash-mainline.md
created: 2026-03-08
due:
---

## Context

- Issue 0022 完成了 `msgcode schedule` CLI 的完整能力（add/list/remove/enable/disable）
- 但 `/schedule` 聊天命令面缺少 `add` 和 `remove` 核心能力
- 当前状态：同域两套合同，能力集合不一致
- 用户反馈：用户在聊天里用 `/schedule` 无法创建 schedule，但 CLI 可以 → 断裂

## Goal / Non-Goals

### Goals
- 统一 schedule 域的双入口合同
- `/schedule` 补齐 `add` / `remove` 命令
- 明确 CLI 为真相源，聊天命令为适配层
- 不新增控制层或编排层

### Non-Goals
- 不重构 scheduler 引擎
- 不新增 LLM tool
- 不删掉 `validate/reload` 辅助命令（保留为运维工具）

## Plan

- [x] 创建 issue + plan 文档
- [x] 在 `cmd-schedule.ts` 中实现 `handleScheduleAddCommand` / `handleScheduleRemoveCommand`
- [x] 复用 `src/cli/schedule.ts` 的同一套参数/校验/错误语义
- [x] 更新 `/schedule` 命令注册 (`commands.ts`)
- [x] 测试验证（62 个测试全部通过）
- [x] 提交 commit (7d89d15)

## Acceptance Criteria

- [x] `/schedule add <scheduleId> --workspace <id|path> --cron <expr> --tz <iana> --message <text>` 可用
- [x] `/schedule remove <scheduleId> --workspace <id|path>` 可用
- [x] CLI 和聊天使用同一套校验逻辑（cron/时区/错误码）
- [x] 不新增 adapter 层，直接复用 CLI 函数

## Notes

### Occam Check

1. **不加它，系统具体坏在哪？**
   - 现状：用户在聊天里用 `/schedule` 无法创建/删除 schedule
   - 失败场景：模型知道 CLI 能 add/remove，但用户在聊天界面做不到
   - 证据：当前 `cmd-schedule.ts` 只有 list/enable/disable/validate/reload

2. **用更少的层能不能解决？**
   - 能：让 `/schedule` 直接复用 `src/cli/schedule.ts` 的同一套逻辑
   - 不新增 adapter 层，不做框架化

3. **这个改动让主链数量变多了还是变少了？**
   - 主链数量不变（仍是一条：聊天 → CLI 逻辑 → 文件）
   - 但消除了"两套合同"的认知负担

### 选型决策

**推荐：CLI 作为真相源**
- `src/cli/schedule.ts` 是正式能力合同
- `/schedule` 聊天命令只是复用 CLI 逻辑的适配层
- `validate/reload` 保留为聊天运维辅助命令（不属于核心 schedule 合同）

### 评审发现（P0/P1 问题）

**P0: job 结构不一致**
- `/schedule add` 手写的 job 结构与 JobScheduler 读取的 CronJob 合同不一致
- 手写 job 只有 `type/enabled/route:string/workspace/schedule:{id,cron,...}`
- 正式 `scheduleToJob()` 返回的 `CronJob` 要求 `name/route.chatGuid/schedule.kind/expr/sessionTarget/payload/delivery.bestEffort/state/createdAtMs/updatedAtMs`
- 修复：改用 `mapSchedulesToJobs`，确保 job 结构与 `scheduleToJob` 一致

**P1: workspace 相对路径解析语义偏离**
- 聊天命令对相对路径：`join(route.workspacePath, input)` — 拼到当前 workspace 下
- CLI 正式口径：`resolve(getWorkspaceRootForDisplay(), input)` + 越界检查
- 修复：复用 CLI 的 `resolveWorkspacePathParam` 逻辑

### 能力矩阵（统一后）

| 命令 | CLI | 聊天 | 说明 |
|------|-----|------|------|
| add | ✅ | ✅ | 核心能力 |
| list | ✅ | ✅ | 核心能力 |
| remove | ✅ | ✅ | 核心能力 |
| enable | ✅ | ✅ | 核心能力 |
| disable | ✅ | ✅ | 核心能力 |
| validate | ❌ | ✅ | 聊天运维辅助 |
| reload | ❌ | ✅ | 聊天运维辅助 |

## Links

- Issue 0022: Scheduler skill + bash 主链收口
- Plan: docs/design/plan-260308-schedule-entry-unification.md
- Commit: 7d89d15 (初版), d3bb696 (修复 P0/P1)
