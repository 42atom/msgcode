---
id: 0156
title: tool bus desktop error preview 继续收口
status: done
owner: agent
labels: [tools, runtime, refactor, docs]
risk: low
scope: 删除 desktop error preview 中不提供新事实的指令式文案
links: []
---

## Context

继续审查 `src/tools/bus.ts` 后，`desktop` 成功 preview 已经是纯事实：`exitCode/stdout/stderr`。剩余更像解释层的是两条 desktop 错误文案：

- `invalid subcommand: ... Use rpc mode with --method`
- `msgcode-desktopctl not found. Build first: ...`

它们在错误事实之外追加了操作指令，不属于最小错误事实。

## Goal / Non-Goals

- Goal: 删掉 desktop error preview 里的指令式补充文案
- Goal: 保留最小错误事实与错误码
- Non-Goals: 本轮不改 `buildToolErrorPreviewText()` 的通用结构
- Non-Goals: 本轮不改 desktop 能力边界与工具集合

## Plan

- [x] 建立 issue，冻结范围
- [x] 删除 desktop error 中的 `Build first` / `Use rpc mode` 指令文案
- [x] 为 invalid subcommand / missing desktopctl 补最小回归锁
- [x] 跑 targeted tests、`npx tsc --noEmit`、`npm run docs:check`
- [x] 更新 Notes 与 `docs/CHANGELOG.md`

## Acceptance Criteria

1. desktop 成功 preview 继续保留 `exitCode/stdout/stderr`
2. invalid subcommand / missing desktopctl 错误只保留最小事实
3. 不削弱 error code / error message / previewText 的诊断能力

## Notes

- 真相源：
  - `aidocs/reviews/20260313-msgcode-thin-runtime-review-rewrite.md`
  - `issues/0154-tool-bus-thin-gateway.md`
  - `issues/0155-tool-bus-preview-meta-thinning.md`
- 2026-03-13:
  - `desktop` 成功 preview 中保留的执行事实：
    - `exitCode`
    - `stdout`
    - `stderr`
    - `durationMs`
  - 删除的解释句：
    - `invalid subcommand: ... Use rpc mode with --method`
    - `msgcode-desktopctl not found. Build first: ...`
  - 保留但未动的 error preview：
    - `buildToolErrorPreviewText()`：只负责 `[tool] error + message` 最小错误事实
    - `abort-demo is for CLI testing only`：是权限边界事实，不是教学层
    - browser / read_file / fs_scope 等错误 preview：当前主要是边界事实，未再发现明确“下一步建议”残留
  - 验证：
    - `PATH="$HOME/.bun/bin:$PATH" bun test test/tools.bus.test.ts test/p5-7-r7a-browser-tool-bus.test.ts`
    - `npx tsc --noEmit`
    - `npm run docs:check`

## Links
