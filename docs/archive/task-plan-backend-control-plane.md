# Task Plan: 本地 backend 控制层与主后端切回 MiniMax

## Goal
先把全局主后端切回 `minimax`，再落地一个薄的本地 backend 控制层 MVP，让 `lmstudio/omlx` 可手动切换、可插拔替换，并保持云端 API 作为当前兜底主链。

## Phases
- [x] Phase 1: 建立计划与真相源
- [x] Phase 2: 核实现状与入口
- [x] Phase 3: 实施配置与代码改动
- [x] Phase 4: 测试验证与交付

## Key Questions
1. 当前主后端切换的唯一入口是什么？
2. 本地 backend 选择应落在哪个配置真相源？
3. 哪些链路必须跟随本地 backend 统一切换？
4. 哪些能力暂时不做自动 fallback，避免加层？

## Decisions Made
- 采用薄控制面：只新增“本地 backend 注册表 + 手动切换配置”，不做自动编排平台。
- 顶层 `AGENT_BACKEND` 保持现有语义；本地后端选择单独收口。
- 本轮只做手动切换 MVP，不做自动故障切换。

## Errors Encountered
- `bun` 不在全局 PATH，但仓库 `npm test` 已通过内置 PATH 包装正常执行
- `npx tsc --noEmit` 暴露仓库既存错误：`src/feishu/transport.ts`、`src/routes/cmd-schedule.ts`

## Status
**Completed** - 已完成主后端切回 `minimax`、本地 backend 注册表、手动切换入口与关键主链接线，并跑过针对性回归测试。
