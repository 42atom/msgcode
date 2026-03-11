---
id: 0071
title: skill layering and conflict policy review
status: open
owner: agent
labels: [docs, refactor]
risk: medium
scope: skill 真相源分层、安装来源、启用方式与冲突规则
plan_doc: docs/design/plan-260311-skill-layering-and-conflict-policy.md
links: []
---

## Context

当前 `msgcode` 已形成两层 skill：

- `src/skills/runtime/`：常驻基础 skill
- `src/skills/optional/`：repo 内置按需 skill

这比早期单一 runtime 口径已经前进了一步，但随着 skill 数量继续增长，仍有几个结构缺口：

- 还没有正式的“用户安装 skill”层
- `workspace` 级 skill 只在文档中提过，未进入正式主链
- 当前运行目录 `~/.config/msgcode/skills/` 同时承载 repo 同步产物与用户自定义产物，来源边界不清
- 没有明确的 conflict policy，无法回答“同名 skill 谁生效”
- 没有统一的 enable/disable 与 gating 规则

OpenClaw 与 Goose 这类系统已经对这些问题给出较成熟处理方式，需要借鉴但不能整套照搬。

## Goal / Non-Goals

- Goal: 研究并冻结 `msgcode` skill 系统的最小分层模型
- Goal: 给出来源层级、启用策略、冲突规则与后续实施顺序
- Goal: 保持薄 core，不把 skill 系统做成 marketplace/platform
- Non-Goals: 本 issue 不直接改 runtime 实现
- Non-Goals: 本 issue 不引入插件市场、远程 registry、版本求解器
- Non-Goals: 本 issue 不重命名现有 `runtime/optional` 目录

## Plan

- [x] 审视当前 `msgcode` skill 目录、同步逻辑与提示词主链
- [x] 对照 OpenClaw 的 bundled/local/workspace precedence 与 per-skill gating
- [x] 对照 Goose 的 platform extensions / session toggles / recipes 思路
- [x] 形成适合 `msgcode` 的最小分层与 conflict policy 方案
- [x] 产出 research + plan 文档

## Acceptance Criteria

1. 明确 `msgcode` 后续 skill 分层至少包含：runtime、system optional、legacy-active、workspace local。
2. 明确同名 skill 的 precedence 与 core 保留区规则。
3. 明确 skill 与 plugin/arm 的边界，不把桌面手臂或其他执行插件混入 skill 主链。
4. 形成可继续实施的设计文档，而不是只停留在聊天结论。

## Notes

- 证据来源：
  - `src/skills/README.md`
  - `src/skills/runtime-sync.ts`
  - `src/skills/runtime/index.json`
  - `src/skills/optional/index.json`
  - OpenClaw 本地文档：
    - `/Users/admin/GitProjects/GithubDown/openclaw/docs/tools/skills.md`
    - `/Users/admin/GitProjects/GithubDown/openclaw/docs/tools/skills-config.md`
    - `/Users/admin/GitProjects/GithubDown/openclaw/docs/cli/plugins.md`
  - Goose 官方文档：
    - [Using Extensions](https://block.github.io/goose/docs/getting-started/using-extensions/)
    - [Recipe Reference Guide](https://block.github.io/goose/docs/guides/recipes/recipe-reference/)

## Links

- Plan: /Users/admin/GitProjects/msgcode/docs/design/plan-260311-skill-layering-and-conflict-policy.md
- Research: /Users/admin/GitProjects/msgcode/docs/notes/research-260311-skill-layering-and-conflict-policy.md
