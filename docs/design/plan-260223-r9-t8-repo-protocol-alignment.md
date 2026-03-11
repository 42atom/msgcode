# plan-260223-r9-t8-repo-protocol-alignment

Issue: 0001
Task: docs/tasks/p5-7-r9-t8-repo-protocol-alignment.md

## Problem

`CLAUDE.md` 定义了文档协议目录与执行流程，但仓库当前仅有 `docs/tasks` 主线，缺少 `issues/design/notes/adr/docs/CHANGELOG.md` 等核心落点，导致规范无法被自动化校验与持续执行。

## Decision

采用“最小迁移 + 兼容保留”方案：

1. 新建协议目录与模板，先建立增量入口，不阻断现有 `docs/tasks` 工作流。
2. `CHANGELOG` 迁移到 `docs/CHANGELOG.md`，根路径保留兼容提示，避免外部索引断裂。
3. 在 `docs:check` 中增加结构化检查，保证后续文档不会退化。

## Plan

1. 建骨架：`issues/`、`docs/design/`、`docs/notes/`、`docs/adr/` + 模板文件。
2. 迁移日志：创建 `docs/CHANGELOG.md`，根 `CHANGELOG.md` 改为兼容入口；新增归档映射文档。
3. 校验增强：扩展 `scripts/check-doc-sync.ts`，检查必需目录/文件与命名规则。
4. 索引同步：更新 `docs/README.md` 和相关任务索引（保留旧路径说明）。
5. 验收：运行 `npm run docs:check`，回写 issue 状态与 Notes 证据。

## Risks

1. 风险：历史文档索引可能仍引用根 `CHANGELOG.md`。
   回滚/降级：保留根路径兼容 stub，旧链接不失效。
2. 风险：`docs:check` 新规则过严导致 CI 阻塞。
   回滚/降级：先只做存在性与命名检查，不做全量历史强校验。

## Alternatives

1. 一次性迁移全部 `docs/tasks` 到 `issues/design`。
   - 优点：结构彻底统一。
   - 缺点：改动面大、风险高、容易破坏现有主线节奏。
2. 仅写规范不做脚本校验。
   - 优点：实施快。
   - 缺点：无法防回退，规范会失效。

（章节级）评审意见：[留空,用户将给出反馈]
