---
id: 0143
title: 退役 system-info auto skill 兼容链
status: done
owner: agent
labels: [architecture, skills, docs, refactor]
risk: low
scope: repo 侧 auto skill 兼容层、说明书与测试对 system-info 的口径
plan_doc: docs/design/plan-260313-retire-system-info-auto-skill.md
links: []
---

## Context

在 `msgcode system` 已退役后，仓库里仍残留一条 repo 侧最小 auto skill 兼容链：

- `src/skills/auto.ts` 会把“系统信息 / system info”自然语言识别成 `system-info`
- `runSkill("system-info")` 会直接在进程内拼装 OS/CPU/Node 信息

这本质上仍是一个“系统信息私有捷径层”：

- 没有跨越新的物理或权限边界
- 没有比原生 `bash` 更强的能力
- 与“本地文件和系统壳操作直接使用原生 Unix/macOS 能力”的新口径冲突

## Goal / Non-Goals

- Goal: 退役 repo 侧 `system-info` auto skill
- Goal: 保留最薄 compat 行为，返回显式 retired 提示并引导回原生 shell
- Goal: 更新 `src/skills/{auto,index,types,README}.ts` 与相关测试口径
- Non-Goals: 本轮不改 runtime `memory/thread/todo/media/gen` skill
- Non-Goals: 本轮不处理 `media screen`、`web fetch` 等下一批候选

## Plan

- [x] 创建 Plan 文档，冻结 system-info auto skill 退役决策
- [x] 将 `src/skills/auto.ts` 改为 retired compat 行为：不再自动命中 system-info，不再成功执行
- [x] 更新 `src/skills/index.ts`、`src/skills/types.ts`、`src/skills/README.md` 的 auto skill 口径
- [x] 更新相关测试并执行 targeted tests
- [x] 更新 issue notes 与 `docs/CHANGELOG.md`

## Acceptance Criteria

1. `detectAutoSkill("系统信息")` 不再返回 `system-info`
2. `runSkill("system-info", ...)` 返回显式 retired 错误，并引导回原生 shell
3. `src/skills/README.md` 不再把 `system-info` 写成现役 auto skill

## Notes

- 关键证据：
  - `src/skills/auto.ts`
  - `src/skills/index.ts`
  - `src/skills/types.ts`
  - `src/skills/README.md`
  - `test/skills.auto.test.ts`
  - `test/p5-6-7-r6-smoke-static.test.ts`
- 2026-03-13:
  - `detectAutoSkill("系统信息")` 与 `normalizeSkillId("system-info")` 已不再命中现役 skill
  - `runSkill("system-info", ...)` 现在只返回 retired 提示，明确要求改用 `bash` + `uname -a` / `sw_vers` / `env` / `printenv`
  - `src/skills/{auto,index,types,README}.ts` 已统一为“repo 侧 auto skill 已退役，仅保留兼容接口”口径
  - 验证：
    - `PATH="$HOME/.bun/bin:$PATH" bun test test/skills.auto.test.ts test/p5-6-7-r6-smoke-static.test.ts test/handlers.runtime-kernel.test.ts`
    - `npx tsc --noEmit`

## Links

- Plan: /Users/admin/GitProjects/msgcode/docs/design/plan-260313-retire-system-info-auto-skill.md
