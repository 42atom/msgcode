---
id: 0138
title: subagent watch 必须以完成标记为唯一成功条件
status: done
owner: agent
labels: [bug, refactor]
risk: medium
scope: 修正 subagent --watch 假完成语义，并用真实 claude-code 任务验收
plan_doc: docs/design/plan-260312-subagent-watch-must-require-completion-marker.md
links: []
---

## Context

`subagent run --watch` 的 MVP 版本把 `handleTmuxSend()` 的同步响应误当成“任务完成”。真实 `claude-code` 验收里，这会导致：

- CLI 很快返回 `completed`
- task JSON 被提前写成 `completed`
- pane 尾部却仍停留在 `Actualizing…`
- 产物文件尚未全部落盘

这违背了 `watch` 的正式语义，也让主脑无法可靠监控子代理。

## Goal / Non-Goals

- Goal: `run --watch` 只在检测到 `MSGCODE_SUBAGENT_DONE/FAILED` 标记时结束。
- Goal: 未检测到标记时，超时后保持 task 为 `running`，并明确提示用户继续用 `status` 查看。
- Goal: 用真实 `claude-code` 子代理任务证明修复生效。
- Non-Goals: 不新增队列、不新增控制面、不改 `subagent` 命令协议。

## Plan

- [x] 收窄 `run --watch` 语义：只认 marker，不再把“有响应”当完成
- [x] 为超时保留 `running` 状态，并返回明确 `WATCH_TIMEOUT`
- [x] 补 targeted runtime tests
- [x] 复跑真实 `claude-code` 贪吃蛇 HTML 项目验收

## Acceptance Criteria

1. `run --watch` 只有在 pane/响应里检测到 `done/failed marker` 时才结束。
2. 未检测到 marker 的情况下，超时会返回 `SUBAGENT_WATCH_TIMEOUT`，task JSON 仍为 `running`。
3. 真实 `claude-code` 贪吃蛇任务在 `test-real` 工作区下，`--watch` 能等到真正完成后再返回。
4. 真实产物至少包括 `index.html`、`style.css`、`game.js`。

## Notes

- 关键修复文件：
  - `src/runtime/subagent.ts`
  - `test/p5-7-r37-subagent-runtime.test.ts`
- 真实验收报告：
  - `AIDOCS/reports/subagent-real-bdd-run-260312-r1.md`
- 验证：
  - `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r37-subagent-runtime.test.ts test/p5-7-r36-subagent-cli-contract.test.ts test/p5-7-r35-subagent-skill-contract.test.ts`
  - `npx tsc --noEmit`
  - `npm run docs:check`
  - 真实命令：`msgcode subagent run claude-code ... --watch`

## Links

- Plan: docs/design/plan-260312-subagent-watch-must-require-completion-marker.md
