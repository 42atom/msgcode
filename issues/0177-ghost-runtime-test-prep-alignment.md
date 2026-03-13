---
id: 0177
title: ghost 运行时测试前对齐
status: done
owner: agent
labels: [chore, runtime, tests]
risk: low
scope: 对齐 ghost 依赖清单与 Tool Bus 分发入口，便于后续冒烟测试
links: []
---

## Context

当前工作树里还剩两处与 ghost 后续测试直接相关的未提交改动：

1. `src/deps/manifest.json` 新增 `ghost` 二进制依赖探测
2. `src/tools/bus.ts` 将 `ghost_*` 分发收口到 `default + isGhostToolName(tool)` 分支

这两处都属于现役 ghost 主链的测试前准备，不应继续悬在工作树里。

## Goal / Non-Goals

### Goal

- 提交 ghost 依赖清单补齐
- 提交 Tool Bus 的 ghost 分发收口
- 通过最小相关回归，便于后续继续做 live 测试

### Non-Goals

- 不处理 `AIDOCS/**` 整理
- 不扩大到其它运行时重构
- 不伪造或补做不存在的 `SKILL.md` 改动

## Plan

- [ ] 验证 `ghost` 相关回归测试
- [ ] 提交 `src/deps/manifest.json`
- [ ] 提交 `src/tools/bus.ts`
- [ ] 更新 issue notes

## Acceptance Criteria

- `ghost-mcp-first-cut` 与 `tools.bus` 相关测试通过
- `npx tsc --noEmit` 通过
- 工作树中这两处 ghost 相关改动已提交

## Notes

- 验证：
  - `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r38-ghost-mcp-skill-guidance.test.ts`
  - `PATH="$HOME/.bun/bin:$PATH" bun test test/ghost-mcp-first-cut.test.ts test/tools.bus.test.ts`
  - `npx tsc --noEmit`
  - `npm run docs:check`
- 提交：
  - `96a8b28 chore: align ghost runtime test prep`

## Links

- `/Users/admin/GitProjects/msgcode/src/deps/manifest.json`
- `/Users/admin/GitProjects/msgcode/src/tools/bus.ts`
