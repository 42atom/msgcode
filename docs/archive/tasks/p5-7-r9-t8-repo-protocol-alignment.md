# 任务单：P5.7-R9-T8（CLAUDE 文档协议目录对齐）

优先级：P0（文档协议可执行性）

状态：✅ 已完成（2026-02-23）

追踪：

- Issue: `issues/tk0001.dne.agent.r9-t8-repo-protocol-alignment.md`
- Plan: `docs/plan/pl0001.dne.agent.r9-t8-repo-protocol-alignment.md`

## 背景

1. `CLAUDE.md` 要求 `issues/ + docs/design + docs/notes + docs/adr + docs/CHANGELOG.md`。
2. 当前仓库主线在 `docs/tasks`，协议目录与自动校验尚未完整落地。

## 目标

1. 建立并启用协议目录与模板。
2. 迁移 changelog 主路径到 `docs/CHANGELOG.md` 并保留旧路径兼容。
3. 在 `docs:check` 增加基础协议检查（存在性 + 命名约束）。
4. 增加 `issue -> plan -> task` 互链强校验（R9-T8b）。

## 分步执行（每步一提交）

1. `docs(p5.7-r9-t8): scaffold protocol directories and templates`
2. `docs(p5.7-r9-t8): migrate changelog path with compatibility archive`
3. `chore(p5.7-r9-t8): enforce protocol checks in docs:check`
4. `docs(p5.7-r9-t8): sync indexes and execution notes`

## 验收门

1. `npm run docs:check`
2. （可选）`npx tsc --noEmit`
3. 关键索引文件路径可解析（旧路径不 404）

## 关键证据

1. 目录存在：`issues/`、`docs/design/`、`docs/notes/`、`docs/adr/`
2. 主路径存在：`docs/CHANGELOG.md`
3. 兼容归档：`docs/archive/protocol-migration/README.md`
4. 校验通过：`npm run docs:check`
5. 类型检查通过：`npx tsc --noEmit`
6. 互链校验：issue/task/plan 回链检查通过
