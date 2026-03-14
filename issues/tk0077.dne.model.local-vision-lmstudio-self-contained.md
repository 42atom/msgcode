---
id: 0077
title: local-vision-lmstudio runtime skill 自带脚本收口
status: done
owner: agent
labels: [bug, refactor, docs]
risk: low
scope: 将 local-vision-lmstudio 从外部 skills 目录依赖收口为 repo 自带 runtime skill 脚本
links:
  - src/skills/runtime/local-vision-lmstudio/SKILL.md
  - src/skills/runtime/local-vision-lmstudio/main.sh
  - test/p5-7-r24-vision-skill-first.test.ts
  - test/p5-7-r13-runtime-skill-sync.test.ts
---

## Context

当前 `local-vision-lmstudio` runtime skill 只有 `SKILL.md + main.sh`，历史上真实实现依赖用户目录里的外部 skill 副本。

这和“repo 维护自己的 skills 真相源”冲突，也会让运行时行为依赖用户机器上的历史目录残留。

## Goal / Non-Goals

- Goal: 把 `analyze_image.py` 正式纳入 repo `src/skills/runtime/local-vision-lmstudio/`
- Goal: wrapper 与文档只依赖 repo/runtime skill 自己的脚本路径
- Goal: 回归锁禁止再次引用 `~/.agents` / `~/.codex` 作为正式实现路径
- Non-Goals: 不改 LM Studio API 主合同
- Non-Goals: 不新增新的视觉控制层或第二套 wrapper

## Plan

- [x] 新增 `src/skills/runtime/local-vision-lmstudio/scripts/analyze_image.py`
- [x] 更新 `src/skills/runtime/local-vision-lmstudio/SKILL.md`
- [x] 更新 `src/skills/runtime/local-vision-lmstudio/main.sh`
- [x] 更新 vision skill 回归测试
- [x] 更新 runtime skill sync 回归测试
- [x] 更新 `docs/CHANGELOG.md`

## Acceptance Criteria

1. repo 内存在 `src/skills/runtime/local-vision-lmstudio/scripts/analyze_image.py`
2. `main.sh` 只调用同目录下的脚本，不再扫描 `~/.agents` / `~/.codex`
3. `SKILL.md` 不再把外部 skills 目录当成正式实现路径
4. 相关测试显式锁住“自带脚本、不依赖外部 skills”语义

## Notes

- 证据：
  - Code: `src/skills/runtime/local-vision-lmstudio/SKILL.md`
  - Code: `src/skills/runtime/local-vision-lmstudio/main.sh`
  - Source: 历史外部脚本已迁入 repo runtime skill 真相源
  - Tests: `python3 -m py_compile src/skills/runtime/local-vision-lmstudio/scripts/analyze_image.py`
  - Tests: `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r24-vision-skill-first.test.ts`
  - Tests: `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r13-runtime-skill-sync.test.ts`

## Links

- Changelog: docs/CHANGELOG.md
