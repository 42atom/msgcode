---
id: 0160
title: desktop 内建桥默认退出 LLM 主链
status: done
owner: agent
labels: [tools, runtime, desktop, refactor, docs]
risk: medium
scope: 将内建 desktop 从默认 tooling.allow 和 LLM 工具暴露主链中移除，保留显式 slash/手动链路
plan_doc: docs/design/plan-260313-desktop-default-off-before-plugin-replacement.md
links: []
---

## Context

当前内建 `desktop` 仍然以第一公民工具身份挂在默认 `tooling.allow` 和 LLM 工具暴露链路里，但仓库已有明确方向：

- `docs/design/plan-260310-ghost-os-desktop-plugin-replacement.md` 已要求冻结自研 desktop 扩张
- 当前自研 desktop 仍依赖 `msgcode-desktopctl` / XPC / Host，明显比 shell、browser、file 更重
- 在开源实现替换前，让这套内建桥继续常驻 LLM 主链，会扩大热路径状态空间

## Goal / Non-Goals

- Goal: 默认 workspace 不再自动允许 `desktop`
- Goal: 即使旧 workspace 显式 allow `desktop`，LLM 工具暴露层也先 suppress 它
- Goal: 保留 `/desktop` 与显式 executeTool 链路，避免一刀切断本地手动能力
- Non-Goals: 本轮不删除 `desktop` ToolName
- Non-Goals: 本轮不删除 `mac/`、`src/runners/desktop.ts` 或 `/desktop` 路由
- Non-Goals: 本轮不引入新 plugin manager / provider 层

## Plan

- [x] 建 issue / plan 冻结范围
- [x] 移除 `DEFAULT_WORKSPACE_CONFIG["tooling.allow"]` 中的 `desktop`
- [x] 将 `desktop` 加入 LLM 默认 suppress 列表
- [x] 调整 `/tool allow` 文案，明确 `desktop` 为遗留显式工具
- [x] 补回归锁并验证
- [x] 更新 `docs/CHANGELOG.md`

## Acceptance Criteria

1. 默认 workspace 工具主链不再包含 `desktop`
2. `getToolsForLlm()` / `resolveLlmToolExposure()` 不再把 `desktop` 暴露给模型
3. `/desktop` 与 Tool Bus 显式 `desktop` 调用测试不回归
4. `npx tsc --noEmit`、`npm run docs:check`、直接相关测试通过

## Notes

- 真相源：
  - `AIDOCS/reviews/20260313-msgcode-thin-runtime-review-rewrite.md`
  - `docs/design/plan-260310-ghost-os-desktop-plugin-replacement.md`
- 实现：
  - `src/config/workspace.ts` 默认 `tooling.allow` 去掉 `desktop`
  - `src/tools/manifest.ts` 将 `desktop` 加入 `LLM_DEFAULT_SUPPRESSED_TOOLS`
  - `src/routes/cmd-tooling.ts` 把 `desktop` 标记为遗留显式工具，不再列入常规可见工具
- 验证：
  - `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-6-8-r4g-pi-core-tools.test.ts test/p5-7-r8c-llm-tool-manifest-single-source.test.ts test/tools.bus.test.ts test/routes.commands.test.ts`
  - `npx tsc --noEmit`
  - `npm run docs:check`

## Links
