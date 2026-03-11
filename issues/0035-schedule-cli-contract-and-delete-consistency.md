---
id: 0035
title: 修复 schedule CLI 命令合同与删除一致性
status: open
owner: agent
labels: [bug, scheduler, agent, cli]
risk: high
scope: scheduler 删除链、CLI 参数合同、jobs 投影同步
plan_doc: docs/design/plan-260308-schedule-cli-contract-and-delete-consistency.md
links: []
---

## Context

### 问题 1: 删除一致性问题（历史）
- 2026-03-07 18:36 出现：`schedule` 文件已删除，但 `jobs.json` 里的 `schedule:246a7f78356b:cron-live` 仍存在
- `runs.jsonl` 继续按分钟 `status=ok`
- **当前状态**：CLI (`schedule.ts:622`) 和聊天路由 (`cmd-schedule.ts:387`) 都已调用 `removeScheduleFromJobs`，代码层面已实现一致性

### 问题 2: CLI 参数合同不稳定（当前）
- `2026-03-07 18:36:25`：
  - 请求进入 `route=tool`, `toolName=bash`
  - 失败：`required option '--workspace <id|path>' not specified`
- `2026-03-07 18:46:59`：
  - 新请求进入真实工具链
  - 失败：`required option '--cron <expr>' not specified`
- 说明 LLM 进入了工具链，但生成的命令参数仍然缺失

### 当前代码状态
- `buildWorkspacePathHint` 已包含 `--workspace` 显式要求（`tool-loop.ts:647-648`）
- scheduler SKILL.md 已包含带 `--workspace` 的示例
- 但 LLM 仍未稳定生成正确命令

## Goal / Non-Goals

### Goal
- 让 add/list/remove 三类 CLI 命令参数合同稳定
- 让 LLM 自然生成正确的 `--workspace <abs-path>` 和 `--cron <expr>`
- 验证删除后 jobs 投影自动消失
- 验证删除后 cron 不再继续跑

### Non-Goals
- 不新增 scheduler 能力
- 不重构整个 agent-first
- 不新增 parser 偷偷补参数
- 不回滚松绑主链

## Plan

- [x] 创建 issue 和 plan（本文件）
- [x] 强化 scheduler SKILL.md 的命令示例（更 explicit）
- [x] 运行 `init --overwrite-skills` 同步到 ~/.config/msgcode/skills/scheduler/
- [x] 验证删除一致性代码已正确（无需改动，schedule.ts:622 + cmd-schedule.ts:387）
- [x] 运行 schedule-contract 测试通过（36 tests pass）
- [ ] 真机 smoke：创建 cron-live -> 删除 -> 验证一致性
- [ ] 提交 commit

## Acceptance Criteria

1. add 命令必须带 `--workspace <abs-path>` 和 `--cron <expr>`
2. remove/list 命令必须带 `--workspace <abs-path>`
3. 删除 schedule 后文件、jobs 投影、cron 运行三者同步消失
4. 测试通过
5. 真机 smoke 通过

## Notes

- 本单聚焦 CLI 参数合同与删除一致性，不再扩到 scheduler 其他能力
- 代码层删除一致性已接好，剩余重点是把 LLM 生成命令合同讲硬
- 真机 smoke 仍是最终验收，但不影响当前文档协议完整性

## Links

- docs/design/plan-260308-schedule-cli-contract-and-delete-consistency.md
- issues/0034-schedule-stop-workspace-and-projection-sync.md
