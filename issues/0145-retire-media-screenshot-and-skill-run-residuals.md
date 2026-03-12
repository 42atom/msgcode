---
id: 0145
title: 退役 media/screenshot 与 /skill run 残余口径
status: done
owner: agent
labels: [architecture, cli, docs, refactor, skills]
risk: low
scope: media CLI、runtime/optional skill 索引与 handlers 测试残余口径
plan_doc: docs/design/plan-260313-retire-media-screenshot-and-skill-run-residuals.md
links: []
---

## Context

前两轮已经退掉 `file/system/web` 包装层，并封死 repo 侧 `system-info` auto skill。但仓库里还残留三类“应退未退”的旧口径：

- `msgcode media screen` 仍是公开 CLI，实质只是对 macOS `screencapture` 的二手壳
- `src/skills/runtime/media/` 与 `src/skills/optional/screenshot/` 仍把截图描述成现役 msgcode CLI 主链
- `handlers` 侧 `/skill run ...` 早已不在运行时主链，但测试仍保留“它会被处理”的旧断言

这会继续浪费 token，并制造“系统其实还有一条隐藏旧链”的假象。

## Goal / Non-Goals

- Goal: 退役 `msgcode media` 公开 CLI 包装层，direct invoke 仅保留 retired compat 提示
- Goal: 从 runtime/optional skill 索引与同步链里移除 `media` / `screenshot`
- Goal: 把 `/skill run ...` 的 handlers 测试口径改成“已删除，禁止回流”
- Non-Goals: 本轮不改 `src/media/*` 媒体处理流水线
- Non-Goals: 本轮不新增新的截图 bridge 或 wrapper

## Plan

- [x] 创建 Plan 文档，冻结 `media/screenshot` 与 `/skill run` 残余退役决策
- [x] 将 `src/cli/media.ts` 收口为 retired compat shell，并更新 `src/cli.ts` / `src/cli/help.ts`
- [x] 从 `src/skills/runtime/index.json`、`src/skills/optional/index.json` 与 `runtime-sync.ts` 移除 `media` / `screenshot`
- [x] 更新 prompt、说明书与 README，去掉对 `msgcode media screen` 的现役叙事
- [x] 更新相关测试并执行 targeted tests、`npx tsc --noEmit` 与 `npm run docs:check`
- [x] 更新 issue notes 与 `docs/CHANGELOG.md`

## Acceptance Criteria

1. `msgcode --help` 不再公开 `media`
2. `msgcode help-docs --json` 不再暴露 `msgcode media screen`
3. runtime skill 主索引不再暴露 `media`，optional 索引不再暴露 `screenshot`
4. `/skill run system-info` 在 handlers 测试里被视为未知历史入口，而非现役链路

## Notes

- 关键证据：
  - `src/cli/media.ts`
  - `src/cli.ts`
  - `src/cli/help.ts`
  - `src/skills/runtime/index.json`
  - `src/skills/optional/index.json`
  - `src/skills/runtime-sync.ts`
  - `test/p5-7-r6-1-media-contract.test.ts`
  - `test/p5-7-r6-4-media-gen-regression-lock.test.ts`
  - `test/p5-7-r13-runtime-skill-sync.test.ts`
  - `test/handlers.runtime-kernel.test.ts`
- 2026-03-13:
  - `msgcode --help` 已不再公开 `media`
  - `msgcode help-docs --json` 已不再导出 `msgcode media screen`
  - `msgcode media ...` direct invoke 现在只返回 retired 提示，并引导回 `screencapture`
  - runtime 主索引已移除 `media`，optional 索引已移除 `screenshot`
  - `runtime-sync` 会主动清退用户目录中的 `media/` 与 `optional/screenshot/` 历史残留
  - handlers 测试已改为锁定 `/skill run ...` 是未知历史入口，不再保留“会被处理”的旧叙事
  - 验证：
    - `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r6-1-media-contract.test.ts test/p5-7-r6-4-media-gen-regression-lock.test.ts test/p5-7-r13-runtime-skill-sync.test.ts test/p5-7-r1c-hard-gate.test.ts test/p5-7-r2-realtime-triad.test.ts test/handlers.runtime-kernel.test.ts test/p5-7-r9-t2-skill-global-single-source.test.ts`
    - `npx tsc --noEmit`
    - `npm run docs:check`

## Links

- Plan: /Users/admin/GitProjects/msgcode/docs/design/plan-260313-retire-media-screenshot-and-skill-run-residuals.md
