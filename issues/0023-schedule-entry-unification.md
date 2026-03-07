---
id: 0023
title: Schedule 域双入口合同统一
status: doing
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
- [ ] 真机验证（聊天 + CLI 行为一致）
- [ ] 提交 commit

## Acceptance Criteria

1. `/schedule add <scheduleId> --workspace <id|path> --cron <expr> --tz <iana> --message <text>` 可用
2. `/schedule remove <scheduleId> --workspace <id|path>` 可用
3. CLI 和聊天使用同一套校验逻辑（cron/时区/错误码）
4. 不新增 adapter 层，直接复用 CLI 函数

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

## Links

- Issue 0022: Scheduler skill + bash 主链收口
- Plan: docs/design/plan-260308-schedule-entry-unification.md
