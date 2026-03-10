---
id: 0061
title: msgcode daemon 保活收口到 launchd
status: done
owner: agent
labels: [feature, refactor, design]
risk: medium
scope: daemon 常驻、进程保活、最小状态诊断
plan_doc: docs/design/plan-260310-msgcode-daemon-keepalive-via-launchd.md
links: []
---

# Context

用户希望 `msgcode` 成为 24 小时长期在线的信息智能体处理中心。当前最大缺口不是 heartbeat 或 `/task`，而是 **daemon 本身没有外部保活**：

- `msgcode start` 只是后台 `spawn + detached + unref`
- daemon 死亡后没有任何 watchdog 或 OS service 负责拉起
- `heartbeat` 只在进程活着时负责任务续跑

参考 `openclaw` 后，结论很明确：

- `openclaw` 的保活主链是 **外部服务管理器（launchd/systemd/Scheduled Task）**
- heartbeat 只负责应用内唤醒，不负责复活死进程

## 关键证据

- [src/cli.ts](/Users/admin/GitProjects/msgcode/src/cli.ts)
  - `launchDaemon()` 当前仅为 detached child
- [src/daemon.ts](/Users/admin/GitProjects/msgcode/src/daemon.ts)
  - 无顶层 `uncaughtException` / `unhandledRejection`
- [src/runtime/heartbeat.ts](/Users/admin/GitProjects/msgcode/src/runtime/heartbeat.ts)
  - 仅负责 tick
- [msgcode.log](/Users/admin/.config/msgcode/log/msgcode.log)
  - `2026-03-10 01:35:55` browser 链进行中 daemon 消失
  - `2026-03-10 01:38:35` 只能人工重启
- [research-260310-openclaw-daemon-keepalive.md](/Users/admin/GitProjects/msgcode/docs/notes/research-260310-openclaw-daemon-keepalive.md)

# Goal / Non-Goals

## Goal

- 让 `msgcode` daemon 在 macOS 上具备可靠常驻能力
- 将进程保活责任从应用内移交给 `launchd`
- 增加最小 crash 观测与状态诊断

## Non-Goals

- 不做跨平台 service framework
- 不把 heartbeat 改造成进程 watchdog
- 不新建控制面或 supervisor 平台
- 不顺手重做 `/task` / heartbeat 主链

# Plan

- [x] 对齐 `daemon.ts` 与 `index.ts` 的顶层异常观测
- [x] 设计最小 `launchd` plist / install / uninstall / status / restart 主链
- [x] 明确 `msgcode start/stop/restart/status` 在 macOS 下的新行为
- [x] 设计最小日志与最后错误诊断口径
- [x] 给出 smoke / rollback / 风险边界

# Acceptance Criteria

- 方案明确采用 `launchd` 外部保活，而不是内部 watchdog
- `msgcode start/stop/restart` 在 macOS 下通过 LaunchAgent 工作
- `msgcode status --json` 能看到 `daemon` 为 `pass`
- launchd 场景下 `imsg` 因权限失效时，daemon 会降级为保留其余 transport 常驻，不再整进程退出

# Notes

- Docs:
  - [research-260310-openclaw-daemon-keepalive.md](/Users/admin/GitProjects/msgcode/docs/notes/research-260310-openclaw-daemon-keepalive.md)
  - [plan-260310-msgcode-daemon-keepalive-via-launchd.md](/Users/admin/GitProjects/msgcode/docs/design/plan-260310-msgcode-daemon-keepalive-via-launchd.md)
- Code:
  - `src/cli.ts`
  - `src/daemon.ts`
  - `src/runtime/heartbeat.ts`
  - `src/commands.ts`
  - `src/runtime/launchd.ts`
  - `src/probe/probes/daemon.ts`
- Tests:
  - `bun test test/runtime.launchd.test.ts`
  - `bun test test/p5-7-r28-daemon-probe.test.ts`
  - `bun test test/commands.startup-guard.test.ts`
- Runtime verification:
  - `./bin/msgcode start` -> `msgcode 已由 launchd 启动 (PID: 33083)`
  - `./bin/msgcode restart` -> `msgcode 已重启 (PID: 33413)`
  - `launchctl print gui/$(id -u)/ai.msgcode.daemon` -> `state = running`, `pid = 33413`
  - `./bin/msgcode status --json` -> `daemon.status = pass`
- Behavioral note:
  - 当前 launchd 进程无法稳定使用 iMessage `chat.db`，因此 `imsg` 会在 launchd 下自动降级，保留 `feishu` 常驻；不再因为单个 transport 权限失败导致 daemon 退出

# Links

- [Plan](/Users/admin/GitProjects/msgcode/docs/design/plan-260310-msgcode-daemon-keepalive-via-launchd.md)
