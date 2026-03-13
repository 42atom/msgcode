---
id: 0162
title: desktop 路由收口为 rpc 单入口
status: done
owner: agent
labels: [desktop, routes, runtime, refactor, docs]
risk: medium
scope: 删除 /desktop 路由层的 shortcut/confirm/doctor 等糖衣，只保留 rpc 显式入口
plan_doc: docs/design/plan-260313-desktop-route-rpc-only-thinning.md
links: []
---

## Context

`src/routes/cmd-desktop.ts` 和 `src/routes/commands.ts` 仍然保留了一套 route 层 desktop 糖衣：

- `/desktop find|click|type|hotkey|wait`
- `/desktop confirm`
- `/desktop ping|doctor|observe`

这些入口会在 route 层替桌面桥做方法翻译、参数改写和下一步引导，偏离“显式方法调用”的单一主链。既然 `desktop` 在 Tool Bus 已经收口为 `method + params`，route 层继续养这套糖衣，只是在继承历史债务。

## Goal / Non-Goals

- Goal: `/desktop` 收口为 `rpc` 单入口
- Goal: 删除 `shortcut` / `confirm` / `ping|doctor|observe` 路由糖衣
- Goal: 帮助文案与现役文档同步改成 RPC 口径
- Non-Goals: 本轮不删除 `desktop` 工具本体
- Non-Goals: 本轮不切换开源 desktop provider
- Non-Goals: 本轮不改 `mac/` 或 `msgcode-desktopctl`

## Plan

- [x] 建 issue / plan 冻结范围
- [x] 修改 `src/routes/cmd-desktop.ts` 只保留 `rpc` 子命令
- [x] 修改 `src/routes/commands.ts` 删除 desktop 糖衣解析
- [x] 更新 `src/routes/cmd-info.ts` 和 `docs/desktop/*` 的现役文案
- [x] 将 `src/routes/cmd-desktop-shortcut.ts`、`src/routes/cmd-desktop-confirm.ts` 移出主链
- [x] 更新 `test/routes.commands.test.ts`
- [x] 跑目标测试、`npx tsc --noEmit`、`npm run docs:check`
- [x] 更新 `docs/CHANGELOG.md`

## Acceptance Criteria

1. `/desktop` 路由只接受 `rpc` 显式入口
2. `/desktop find|click|type|hotkey|wait|confirm|ping|doctor|observe` 不再被 route 层改写成 desktop RPC
3. 帮助与现役文档不再教这套旧糖衣
4. 目标回归、`npx tsc --noEmit`、`npm run docs:check` 通过

## Notes

- 真相源：
  - `AIDOCS/reviews/20260313-msgcode-thin-runtime-review-rewrite.md`
  - `issues/0161-desktop-legacy-runner-one-shot-cli.md`
- 实现：
  - `src/routes/cmd-desktop.ts` 现在只保留 `/desktop rpc ...`
  - `src/routes/commands.ts` 删除 `find/click/type/hotkey/wait/confirm/ping/doctor/observe` 的专门改写
  - `src/routes/cmd-desktop-shortcut.ts`、`src/routes/cmd-desktop-confirm.ts` 已移到 `.trash/2026-03-13-desktop-route-rpc-only/src/routes/`
  - `src/routes/cmd-info.ts` 与 `docs/desktop/*` 已同步为 RPC-only 文案
- 验证：
  - `PATH="$HOME/.bun/bin:$PATH" bun test test/routes.commands.test.ts test/tools.bus.test.ts`
  - `npx tsc --noEmit`
  - `npm run docs:check`

## Links
