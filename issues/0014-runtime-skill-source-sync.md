---
id: 0014
title: Runtime skill 仓库源与安装目录单一真相源
status: doing
owner: agent
labels: [feature, refactor, docs]
risk: medium
scope: skills/install/startup/config-contract
plan_doc: docs/design/plan-260307-runtime-skill-source-sync.md
links:
  - issues/0013-pinchtab-single-browser-substrate-bootstrap.md
created: 2026-03-07
due:
---

## Context

- 当前 `~/.config/msgcode/skills/pinchtab-browser/` 是手工落盘的 runtime skill，仓库里没有对应真相源。
- `src/cli.ts` 里原有的 `copySkillsToUserConfig()` 逻辑仍指向已不存在的 `src/skills/builtin/`，与当前 runtime skill 结构不一致。
- 用户已明确要求内部和安装后的 skill 统一，避免未来安装链遗漏 `pinchtab-browser` 或再次依赖手工修补。

## Goal / Non-Goals

### Goals

- 在仓库内增加托管 runtime skill 真相源。
- 让 `msgcode init` 和 `msgcode start` 都能幂等同步托管 runtime skills 到 `~/.config/msgcode/skills/`。
- 保留用户自定义 skills，不因为托管 skill 同步而被覆盖或删除。
- 用测试锁住 `pinchtab-browser` 的安装与索引合并行为。

### Non-Goals

- 本轮不重做整个历史 skill 系统。
- 本轮不把所有现有用户 skill 全量迁入仓库，只先收口托管的 `pinchtab-browser`。
- 本轮不修改 tool loop 的技能读取口径，仍以 `~/.config/msgcode/skills/index.json` 为运行时真相源。

## Plan

- [ ] 创建并评审 Plan 文档：`docs/design/plan-260307-runtime-skill-source-sync.md`
- [ ] 新增仓库托管 runtime skill 源目录：`src/skills/runtime/`
- [ ] 新增同步模块并替换 `src/cli.ts` 里的旧安装逻辑
- [ ] 在 `startBot()` 接入 best-effort runtime skill 同步
- [ ] 更新 `src/skills/README.md` 和 `docs/CHANGELOG.md`
- [ ] 补充同步回归测试并运行定向验证
- [ ] 将本地 `~/.config/msgcode/skills/` 同步到最新托管版本

## Acceptance Criteria

1. 仓库内存在 `pinchtab-browser` 的托管 runtime skill 真相源。
2. `msgcode init` 会把托管 runtime skill 同步到 `~/.config/msgcode/skills/`。
3. `msgcode start` 即使未执行过 `init`，也会 best-effort 补齐托管 runtime skill。
4. 现有自定义 skill 与 `index.json` 不会在同步过程中丢失。
5. 至少有一组测试锁住文件同步和索引合并行为。

## Notes

- User 要求：内部和安装后的 skill 统一，避免依赖丢失。
- Code：
  - `src/cli.ts`
  - `src/commands.ts`
  - `src/skills/README.md`
  - `src/skills/runtime-sync.ts`
- Runtime source：
  - `~/.config/msgcode/skills/pinchtab-browser/`

## Links

- Plan: `docs/design/plan-260307-runtime-skill-source-sync.md`
- Related: `issues/0013-pinchtab-single-browser-substrate-bootstrap.md`
