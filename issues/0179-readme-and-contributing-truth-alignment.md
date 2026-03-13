---
id: 0179
title: README 与贡献指南真相对齐
status: done
owner: agent
labels: [docs, chore]
risk: low
scope: 收口 README / src README / docs README / CONTRIBUTING 的现役口径
plan_doc: docs/design/plan-260313-readme-and-contributing-truth-alignment.md
links: []
---

## Context

代码主链已经切到 `ghost_*` 与薄 runtime，但 README 体系还存在几处滞后：

- 最终方向“menu App + 单面板 + web系统面板”未被明确写入
- `ghost-os` 在根 README 中仍被写成“可选”
- 未明确声明 msgcode 不再自研点击/识别逻辑，只做薄桥接
- `src/README.md` 尚可进一步强调 Tool Bus 单一真相源
- 仓库缺少一份对外贡献指南来解释 `docs/`、`AIDOCS/`、本地私有文件与现役边界

## Goal / Non-Goals

### Goal

- 对齐根 README、`src/README.md`、`docs/README.md`
- 新增 `CONTRIBUTING.md`
- 用统一口径表达最终方向、Ghost 地位、薄桥接原则、Bus 单一真相源

### Non-Goals

- 不修改运行时代码
- 不引入外部结构参考名词
- 不重写整个产品叙事文档

## Plan

- [x] 更新 `README.md`
- [x] 更新 `src/README.md`
- [x] 更新 `docs/README.md`
- [x] 新增 `CONTRIBUTING.md`
- [x] 更新 `docs/CHANGELOG.md`
- [x] 运行 `npm run docs:check`

## Acceptance Criteria

- README 体系明确“menu App + 单面板 + web系统面板”是最终方向
- `ghost-os` 被写成默认且唯一的桌面自动化桥
- 文档明确 msgcode 不再自研点击/识别逻辑
- `src/README.md` 强化 Tool Bus 单一真相源原则
- 仓库新增 `CONTRIBUTING.md`

## Notes

- 对外统一说法：`menu App + 单面板 + web系统面板`
- 不提任何外部实现名词作为结构参考
- 已更新 `README.md`、`src/README.md`、`docs/README.md` 与 `CONTRIBUTING.md`
- `npm run docs:check` 通过

## Links

- docs/design/plan-260313-readme-and-contributing-truth-alignment.md
