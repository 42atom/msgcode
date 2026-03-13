---
id: 0163
title: ghost-os 第一刀：ghost mcp 原生挂载
status: done
owner: agent
labels: [feature, refactor, docs]
risk: medium
scope: tools/bus + ghost mcp runner + runtime skill + README 安装口径
plan_doc: docs/design/plan-260310-ghost-os-desktop-plugin-replacement.md
links:
  - AIDOCS/reports/260313-ghost-os-integration-plan.md
  - /Users/admin/GitProjects/GithubDown/ghost-os/GHOST-MCP.md
---

## Context

当前 `msgcode` 的 legacy 桌面链路仍以 `desktop -> msgcode-desktopctl -> host` 形式存在，但已经退出默认 LLM 主链。冻结设计要求第一刀直接把 `ghost-os` 作为外部 provider 以最薄方式挂入，让 Agent 直接拿到 `ghost_*` 原生工具，不再长期保留 `desktop.* -> ghost_*` 兼容假面具。

本轮只做：

- `ghost` binary 探测
- `ghost status/doctor` 最小健康检查
- `ghost mcp` stdio 挂载
- `ghost_*` 原生工具注册到 manifest / Tool Bus
- msgcode 本地 ghost runtime skill 与 README 安装指引

## Goal / Non-Goals

- Goal: 让 Agent 在当前 Tool Bus 单一真相源下直接暴露并调用 `ghost_*` 原生工具，缺失 `ghost` 时 fail-closed 返回真实安装事实。
- Goal: 保持主链为“模型 -> ghost_* -> ghost mcp -> 真实结果 -> 模型”。
- Non-Goals: 不把 `ghost-os` 嵌进 core。
- Non-Goals: 不新增 desktop manager / plugin platform / supervisor。
- Non-Goals: 不长期保留 `desktop.* -> ghost_*` adapter。
- Non-Goals: 不静默代装 `ghost-os`，不重写 `ghost setup/doctor` 业务逻辑。

## Plan

- [x] 建立 evidence-first 基线：确认 `desktop` 当前退出默认 LLM 主链，明确 ghost 挂载 seam。
- [x] 新增最薄 `ghost-mcp-client`，完成 `ghost` binary 探测、`status/doctor` 健康检查、MCP initialize/list/call。
- [x] 把 `ghost_*` 正式接入 `ToolName`、manifest、Tool Bus 与默认 `tooling.allow`。
- [x] 补 runtime skill、README、CHANGELOG 与直接相关回归。
- [x] 跑 `bun test`、`npx tsc --noEmit`、`npm run docs:check`，回填 issue Notes。

## Acceptance Criteria

1. Agent 暴露 `ghost_*` 原生工具，且不是通过长期 `desktop.*` 翻译层实现。
2. Tool Bus 主链保持薄：探测 binary、连接 `ghost mcp`、调工具、返回真实结构化结果。
3. 缺失 `ghost-os` 时，返回真实缺失事实与安装指引，不静默 fallback。
4. skill 明确覆盖：先看 recipes、先 `ghost_context`、Web 场景优先 `dom_id`、失败优先 `ghost_annotate / ghost_screenshot / ghost_ground`。
5. README 补 `brew install ghostwright/ghost-os/ghost-os`、`ghost setup`、`ghost doctor` 安装与健康检查指引。
6. 通过 `bun test`、`npx tsc --noEmit`、`npm run docs:check`。

## Notes

- Evidence:
  - Docs: `docs/design/plan-260310-ghost-os-desktop-plugin-replacement.md`
  - Docs: `AIDOCS/reports/260313-ghost-os-integration-plan.md`
  - Docs: `/Users/admin/GitProjects/GithubDown/ghost-os/GHOST-MCP.md`
- Baseline:
  - `src/tools/manifest.ts` 当前默认 suppress `desktop`
  - `src/runners/desktop.ts` 当前仍走 `msgcode-desktopctl rpc`
  - `src/agent-backend/tool-loop.ts#getToolsForLlm()` 仅暴露 manifest 中已注册正式工具
- Implementation:
  - 新增 `src/runners/ghost-mcp-contract.ts` 作为 ghost 工具名/参数/risk/sideEffect 单一真相源
  - 新增 `src/runners/ghost-mcp-client.ts`，只做 binary 探测、`status/doctor` 健康检查和 `ghost mcp` stdio 调用
  - `src/tools/{types,manifest,bus}.ts` 已直接接入 `ghost_*` 正式工具面，不走 `desktop.*` 映射
  - `src/config/workspace.ts` 默认 `tooling.allow` 已纳入 `ghost_*`
  - `src/skills/runtime/ghost-mcp/SKILL.md` 与 `README.md` 已补本地安装和使用顺序
- Verification:
  - `npx tsc --noEmit`
    - 结果：通过（无输出）
  - `PATH="$HOME/.bun/bin:$PATH" bun test test/ghost-mcp-first-cut.test.ts test/tools.bus.test.ts test/p5-7-r8c-llm-tool-manifest-single-source.test.ts test/p5-6-8-r4g-pi-core-tools.test.ts`
    - 结果：85 pass / 0 fail
  - `npm run docs:check`
    - 结果：`✓ 文档同步检查通过`
- Review follow-up:
  - 已修 P1：ghost 给模型看的 name/description/schema 不再来自本地硬编码镜像；`src/tools/manifest.ts` 现在通过 `getRegisteredToolManifests()` 动态读取 `ghost mcp tools/list` 并派生 ghost manifests，`tool-loop` 也改为按 workspace 走动态 schema/index 渲染。
  - 已修 P2：`README.md` 不再把 `open mac/...`、`/desktop health`、`/desktop observe` 当作推荐路径；Desktop Bridge 段落已改成 legacy 明示口径。
- 风险与边界：
  - 本轮没有删除 legacy `desktop` 显式链路，只让 `ghost_*` 进入正式工具主链
  - 本轮未新增 token gate；若未来需要高危动作确认，只允许落在 `ghost-mcp-client`
  - `ghost-os` 缺失或未 ready 时，当前行为是 fail-closed 返回安装/诊断事实，不做 silent fallback
- 当前状态：
  - 本地实现与验证完成，待用户验收/后续合并

## Links

- Plan: `docs/design/plan-260310-ghost-os-desktop-plugin-replacement.md`
- Report: `AIDOCS/reports/260313-ghost-os-integration-plan.md`
- Ghost MCP: `/Users/admin/GitProjects/GithubDown/ghost-os/GHOST-MCP.md`
