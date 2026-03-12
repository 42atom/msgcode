---
id: 0096
title: launchd 守护环境收口为 Feishu-only
status: done
owner: agent
labels: [bug, refactor, runtime]
risk: medium
scope: launchd 守护安装主链不得把 retired imsg transport/env 回流到 daemon
plan_doc: docs/design/plan-260312-launchd-feishu-only-env-sanitization.md
links:
  - issues/0093-feishu-only-channel-simplification-and-imsg-sunset.md
  - issues/0061-msgcode-daemon-keepalive-via-launchd.md
---

## Context

本轮大重构后，正式消息主链已经收口为 Feishu-only，但真实运行中出现了一次 daemon “看起来没反应”的事故。排查结果表明：

- `launchd` 托管的 daemon 没有卡在模型层，而是在启动入口直接失败
- 根因是 LaunchAgent plist 的 `EnvironmentVariables` 仍保存了旧的 `MSGCODE_TRANSPORTS=imsg,feishu`
- `src/runtime/launchd.ts` 当前会把整个 `process.env` 原样复制进 LaunchAgent，这让 shell / `.env` 中的 retired iMessage 配置可以重新污染守护主链

证据：

- `/Users/admin/.config/msgcode/log/daemon.stderr.log`
- `/Users/admin/Library/LaunchAgents/ai.msgcode.daemon.plist`
- `launchctl print gui/$(id -u)/ai.msgcode.daemon`

## Goal / Non-Goals

- Goal: launchd 生成的 daemon 环境固定收口为当前正式主链，不再回流 retired `imsg` transport/env
- Goal: 给这条启动主链补回归测试，避免后续 `msgcode start/restart` 再生成脏 plist
- Non-Goals: 不重做 launchd 模块，不改 daemon/probe 主链，不顺手迁移 `runtime.current_chat_guid`

## Plan

- [x] 新增最小设计文档，冻结本轮 Occam 取舍
- [x] 在 `src/runtime/launchd.ts` 中收口 daemon 环境：强制 `MSGCODE_TRANSPORTS=feishu`，剥离 retired `IMSG_*` 启动变量
- [x] 在 `test/runtime.launchd.test.ts` 增加回归锁，覆盖 legacy transport/env 不得回流
- [x] 运行 targeted tests、typecheck，并用真实 launchd 重写一次 plist 验证运行态
- [x] 更新 issue/plan notes 与 changelog，完成收口

## Acceptance Criteria

1. 重新执行 `msgcode start/restart` 时，LaunchAgent plist 中不再出现 `MSGCODE_TRANSPORTS=imsg*`
2. `IMSG_PATH`、`IMSG_DB_PATH` 等 retired 启动变量不会再被写入 LaunchAgent 环境
3. `runtime.launchd` 回归测试能锁住上述行为
4. 真实 daemon 在 launchd 下能正常进入 `running`，并在日志里完成 Feishu transport 启动

## Notes

- 2026-03-12 09:4x：现场根因已锁定到 LaunchAgent 环境污染，不是模型/消息队列卡死
- 当前用户侧已临时手工改正 `~/.config/msgcode/.env` 与 `~/Library/LaunchAgents/ai.msgcode.daemon.plist`
- 本轮还需要把代码层口径补上，避免下次 `msgcode restart` 复发
- 已落地：
  - `src/runtime/launchd.ts` 现在会在生成 LaunchAgent 环境时强制写入 `MSGCODE_TRANSPORTS=feishu`
  - `IMSG_PATH` / `IMSG_DB_PATH` 不再被带入 launchd daemon 环境
  - `test/runtime.launchd.test.ts` 已新增回归锁
- 验证：
  - `PATH="$HOME/.bun/bin:$PATH" bun test test/runtime.launchd.test.ts test/p5-7-r29-feishu-first-transport-default.test.ts test/p5-7-r37-imsg-probe-sunset.test.ts test/p5-7-r28-daemon-probe.test.ts`
  - `npx tsc --noEmit`
  - `npm run docs:check`
  - `node --import tsx src/cli.ts restart`
  - `launchctl print gui/$(id -u)/ai.msgcode.daemon`

## Links

- Plan: /Users/admin/GitProjects/msgcode/docs/design/plan-260312-launchd-feishu-only-env-sanitization.md
