---
id: 0050
title: /where 与 /bind 显示真实运行态而不是 legacy runner
status: done
owner: agent
labels: [bug]
risk: low
scope: 群聊 /where 与 /bind 的运行态展示口径
links: []
---

## Context

- 用户在飞书群里看到 `/where` 返回“模型客户端: lmstudio”，但当前实际执行后端已切到 `minimax`。
- 代码现状：
  - 实际执行链在 `src/handlers.ts` 只读全局 `AGENT_BACKEND`。
  - `/bind` 与 `/where` 在 `src/routes/cmd-bind.ts` 仍通过 `getDefaultRunner()` 读取 workspace `runner.default`，属于 legacy 兼容字段。
- 结果是展示层和执行层出现双真相源，直接误导排障。

## Goal / Non-Goals

- Goal: 让 `/bind` 与 `/where` 展示真实运行态。
- Goal: agent 模式显示 `Agent Backend`，tmux 模式显示 `Tmux Client`。
- Non-Goals: 本轮不清理 `RouteStore.modelClient` 历史字段，不重写 `/bind` 第二参数语义。

## Plan

- [x] 定位 `/where` 与真实执行链的取值分裂点
- [x] 修改 `src/routes/cmd-bind.ts`，统一按 runtime.kind + 全局 `AGENT_BACKEND` 展示
- [x] 增加 agent/tmux 两条回归锁
- [x] 更新 changelog 与 issue 结果

## Acceptance Criteria

1. `/where` 在 agent 模式下显示真实 `Agent Backend`，不再被 workspace `runner.default` 误导。
2. `/where` 在 tmux 模式下显示真实 `Tmux Client`。
3. 针对性测试覆盖 legacy `runner.default=lmstudio` + `AGENT_BACKEND=minimax` 的回归场景。

## Notes

- Evidence:
  - Code: `src/routes/cmd-bind.ts`, `src/handlers.ts`
  - Logs: `~/.config/msgcode/log/msgcode.log` 中 `agentBackend=minimax`
  - Config: `~/.config/msgcode/.env` 中 `AGENT_BACKEND=minimax`
- Result:
  - `/bind` 与 `/where` 不再显示“模型客户端: <runner.default>”
  - agent 模式统一显示 `Agent Backend`
  - tmux 模式统一显示 `Tmux Client`
- Tests:
  - `npm test -- --runInBand test/routes.commands.test.ts`
  - 结果：`60 pass / 0 fail`

## Links

- Code: `src/routes/cmd-bind.ts`
- Tests: `test/routes.commands.test.ts`
- Changelog: `docs/CHANGELOG.md`
