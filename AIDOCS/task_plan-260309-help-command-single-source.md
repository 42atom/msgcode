# Task Plan: /help 命令方案文档

## Goal

产出一份基于真实代码现状的方案文档，说明如何把 `/help` 相关代码写得更简单优雅。

## Phases

- [x] Phase 1: 盘点相关文件与现状
- [x] Phase 2: 识别漂移点与边界
- [x] Phase 3: 形成方案对比与推荐决策
- [x] Phase 4: 交付正式方案文档

## Key Questions

1. `/help` 的真实真相源应该放在哪里？
2. 需要收口到什么程度才算“简单”，而不是再次平台化？
3. 哪些部分本轮不该动？

## Decisions Made

- 决策：以 `src/routes/cmd-info.ts` 内的 help 元数据为最小真相源，不新增独立 registry 文件
- 决策：CLI `help-docs` 暂不并入本轮主链，只保留边界说明
- 决策：方案文档落在 `aidocs/design/`，并补 issue/task 留痕

## Errors Encountered

- 无执行错误；发现的是架构口径漂移，而非单点运行错误

## Status

**已完成** - 正在交付正式方案文档
