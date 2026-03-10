---
id: 0067
title: 以 ghost-os 替换自研桌面执行层的插件化迁移方案
status: open
owner: agent
labels: [architecture, plugin, desktop]
risk: medium
scope: mac 桌面执行层、desktop plugin contract、core/plugin 边界
plan_doc: docs/design/plan-260310-ghost-os-desktop-plugin-replacement.md
links: []
---

## Context

用户明确提出两个冻结判断：

- `mac` 部分属于插件能力（手臂），不是 core（大脑）
- 所有插件级能力必须可关闭，不能污染 `msgcode core`

同时，本地引入了 `ghost-os` 仓库。研究结果表明，`ghost-os` 已经是比当前 `msgcode/mac` 更成熟的 desktop computer-use substrate，而 `msgcode/mac` 当前更像权限宿主、bridge 与桌面壳。

当前需要正式决定：

- 是否停止继续扩张自研桌面执行层
- 是否改为让 `ghost-os` 作为桌面插件实现
- 如何保证这次替换不反向污染 core

## Goal / Non-Goals

- Goal: 冻结 `ghost-os` 替换自研桌面执行层的方向
- Goal: 明确 `core / plugin / shell` 三层边界
- Goal: 明确“插件可关闭、不得污染 core”的硬约束
- Non-Goals: 本轮不做接入实现
- Non-Goals: 本轮不删除 `mac/` 目录
- Non-Goals: 本轮不改变 Agent Core Phase 1-5 的排期

## Plan

- [x] 输出正式 Plan 文档，固定 `ghost-os` 的分层位置与迁移策略
- [x] 明确 `msgcode core` 必须保留的边界与 desktop plugin 不得越界的清单
- [x] 明确当前 `mac/` 中哪些应冻结、哪些应保留为 shell
- [x] 给出后续实施阶段顺序，但不在本轮实现

## Acceptance Criteria

1. 文档必须明确回答：替换的是哪一层，不是哪一层
2. 文档必须明确写出“插件可关闭、不得污染 core”的执行约束
3. 文档必须给出最小迁移路径，而不是大爆炸重构

## Notes

- Research: `docs/notes/research-260310-ghost-os-desktop-plugin-gap.md`
- Related: `docs/notes/research-260310-thin-core-plugin-topology.md`
- Related: `docs/notes/research-260310-openclaw-terminal-agent-harness.md`
- Current mac host docs: `mac/README.md`
- ghost-os docs: `/Users/admin/GitProjects/GithubDown/ghost-os/README.md`

## Links

- Plan: `docs/design/plan-260310-ghost-os-desktop-plugin-replacement.md`
- Research: `docs/notes/research-260310-ghost-os-desktop-plugin-gap.md`
