---
id: 0161
title: desktop legacy runner 改为单次 CLI 调用
status: done
owner: agent
labels: [desktop, tools, runtime, refactor, docs]
risk: medium
scope: 将 legacy desktop runner 从自管 session 池收口为单次 msgcode-desktopctl rpc 调用
plan_doc: docs/design/plan-260313-desktop-legacy-runner-one-shot-cli.md
links: []
---

## Context

`src/runners/desktop.ts` 当前仍然维护一套厚重的遗留 session 逻辑：

- `DesktopSessionPool`
- 长驻子进程
- idle 清理计时器
- stdio NDJSON 请求队列
- 单飞状态机

但 `msgcode-desktopctl` 本身已经提供单次 `rpc` 命令。继续在 msgcode 里维持这套 session 池，相当于在 legacy bridge 外面再包一层状态控制面，违背“旧桥退成普通外部命令壳”的目标。

## Goal / Non-Goals

- Goal: 删除 desktop runner 中的 session 池与常驻子进程逻辑
- Goal: runner 改为单次 `msgcode-desktopctl rpc` 调用
- Goal: 保留现有 `DesktopRunnerOptions` / `DesktopRunnerResult` 合同
- Non-Goals: 本轮不删除 `/desktop` 路由
- Non-Goals: 本轮不删除 `mac/` 或 `msgcode-desktopctl`
- Non-Goals: 本轮不引入 desktop provider / plugin manager

## Plan

- [x] 建 issue / plan 冻结范围
- [x] 删 `DesktopSessionPool` 与 session 队列逻辑
- [x] 用单次 `msgcode-desktopctl rpc` 调用替换 runner 主链
- [x] 保留 evidence artifact 解析
- [x] 跑 desktop 直接相关回归、`npx tsc --noEmit`、`npm run docs:check`
- [x] 更新 `docs/CHANGELOG.md`

## Acceptance Criteria

1. `src/runners/desktop.ts` 不再包含 session 池、idle 清理器和 stdio NDJSON 队列
2. `desktop` runner 主链收口为单次 CLI 调用
3. `desktop` 现有 Tool Bus / slash 相关回归不回归
4. `npx tsc --noEmit`、`npm run docs:check`、目标测试通过

## Notes

- 真相源：
  - `AIDOCS/reviews/20260313-msgcode-thin-runtime-review-rewrite.md`
  - `docs/design/plan-260310-ghost-os-desktop-plugin-replacement.md`
- 实现：
  - `src/runners/desktop.ts` 删除 `DesktopSessionPool`、session 队列和 idle 清理器
  - runner 改为单次 `msgcode-desktopctl rpc` 调用
  - 保留 `findDesktopctlPath()` 与 evidence artifact 解析
- 验证：
  - `PATH="$HOME/.bun/bin:$PATH" bun test test/tools.bus.test.ts test/routes.commands.test.ts`
  - `npx tsc --noEmit`
  - `npm run docs:check`

## Links
