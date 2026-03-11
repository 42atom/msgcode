---
id: 0064
title: permissions probe 仅在启用 imsg 时检查 chat.db
status: done
owner: agent
labels: [bug, refactor]
risk: medium
scope: status 权限探针 / transport 口径
plan_doc: docs/design/plan-260310-permissions-probe-imsg-conditional.md
links: []
---

# Context

在 [Issue 0062](/Users/admin/GitProjects/msgcode/issues/0062-feishu-first-imsg-optional.md) 把默认主链改成 `Feishu-first` 后，权限探针仍无条件检查：

- `~/Library/Messages`
- `~/Library/Messages/chat.db`

这会导致一个只启用飞书、不使用 iMessage 的部署，在没有 Full Disk Access 时仍被 `msgcode status` 标成 `error`，和当前产品定位冲突。

# Goal / Non-Goals

## Goal

- 仅在启用 `imsg` transport 时检查 Messages / chat.db 权限
- Feishu-only 场景下不再被 iMessage 权限误伤

## Non-Goals

- 不修改真正的 iMessage 启动逻辑
- 不重做 probe 框架
- 不顺手处理其他 probe 的 transport 条件化

# Plan

- [x] 将 `permissions` probe 改为 transport-aware
- [x] Feishu-only 时将 Messages/chat.db 字段标为跳过，而非 false
- [x] 补回归测试锁住 `feishu-only` 与 `imsg` 两条路径
- [x] 更新 changelog 与 issue 留痕

# Acceptance Criteria

- `config.transports=["feishu"]` 时，缺失 `~/Library/Messages` / `chat.db` 不再导致 `permissions.status=error`
- `config.transports=["imsg"]` 时，继续保持原来的严格行为

# Notes

- Review finding:
  - `src/probe/probes/permissions.ts` Feishu-only 仍会被 iMessage 权限探针打成 error
- Code:
  - `src/probe/probes/permissions.ts`
  - `test/p5-7-r30-permissions-probe-transport-aware.test.ts`
- Tests:
  - `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r30-permissions-probe-transport-aware.test.ts`
  - `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r28-daemon-probe.test.ts test/p5-7-r29-feishu-first-transport-default.test.ts`

# Links

- [Plan](/Users/admin/GitProjects/msgcode/docs/design/plan-260310-permissions-probe-imsg-conditional.md)
