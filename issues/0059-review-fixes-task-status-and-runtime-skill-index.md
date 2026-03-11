---
id: 0059
title: 评审修复：任务状态收口与 runtime skill 索引一致性
status: done
owner: agent
labels: [bug, refactor]
risk: medium
scope: task-supervisor 状态推进与 runtime skill 真相源一致性
plan_doc: docs/design/plan-260310-review-fixes-task-status-and-runtime-skill-index.md
links: []
---

## Context

对 `0f203ea` 的自评审发现两条主链问题：

1. `TaskSupervisor.updateTaskResult()` 忽略显式 `result.status`，会把调用方明确给出的 `failed/completed` 重算成别的状态。
2. `src/skills/runtime/index.json` 已引用 `vision-index`、`local-vision-lmstudio`、`zai-vision-mcp`，但上一提交未把这三个 runtime skill 目录带进 git，导致 clean checkout 下 skill 索引失真。

同时还暴露出一个预算语义问题：

- `/task resume` 在真正执行下一轮之前，就先消耗一次 `attemptCount`。

## Goal / Non-Goals

- Goal:
  - 修复 `updateTaskResult()` 对显式状态的错误重算
  - 让 checkpoint 与最终状态保持一致
  - 修复 `/task resume` 的 attempt budget 提前消耗
  - 让 runtime skill 索引与 git 中实际托管文件一致
- Non-Goals:
  - 不重做整个 `/task` 状态机
  - 不改 skill-first 视觉路线
  - 不新增新的恢复层或索引层

## Plan

- [x] 新建 review-fix plan 文档，明确最小修法
- [x] 修复 `task-supervisor.ts` 状态推进与 resume budget 语义
- [x] 把 vision runtime skill 目录纳入仓库真相源
- [x] 补回归锁：显式 failed/completed、resume attempt、runtime skill tracked 一致性
- [x] 运行针对性测试并更新变更日志

## Acceptance Criteria

1. 显式 `failed` 不得被回退成 `pending`
2. 缺少 verify 的 `completed` 不得留下 `checkpoint.currentPhase=completed`
3. `/task resume` 不得在执行前抢先递增 `attemptCount`
4. `src/skills/runtime/index.json` 中列出的托管 vision skill 在仓库里真实存在

## Notes

- Review findings:
  - `src/runtime/task-supervisor.ts`
  - `src/skills/runtime/index.json`
- Code:
  - `src/runtime/task-supervisor.ts`
  - `src/skills/runtime/vision-index/`
  - `src/skills/runtime/local-vision-lmstudio/`
  - `src/skills/runtime/zai-vision-mcp/`
  - `test/p5-7-r12-agent-relentless-task-closure.test.ts`
  - `test/p5-7-r13-runtime-skill-sync.test.ts`
- Tests:
  - `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r12-agent-relentless-task-closure.test.ts test/p5-7-r12-t9-mainline-quota-continuation-smoke.test.ts test/p5-7-r13-runtime-skill-sync.test.ts`
  - `26 pass / 0 fail`
- Runtime:
  - `./bin/msgcode restart`

## Links

- Plan: /Users/admin/GitProjects/msgcode/docs/design/plan-260310-review-fixes-task-status-and-runtime-skill-index.md
