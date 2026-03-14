# plan-260313-root-doc-slimming-followup

## Problem

legacy desktop bridge 已被整包归档，但根目录仍保留 `SECURITY.md` 与 `task_plan.md`。前者是明确绑定旧 bridge 的安全文档，后者是历史任务计划，两者继续停在根目录都会污染现役入口的清晰度。

## Occam Check

- 不加它，系统具体坏在哪？
  - 不会影响运行时，但根目录继续显得杂乱，旧 bridge 安全策略和历史计划仍被误读成现役文档。
- 用更少的层能不能解决？
  - 能。直接迁入 archive，不新增任何索引层或兼容层。
- 这个改动让主链数量变多了还是变少了？
  - 变少了。根目录继续只保留当前现役入口文档。

## Decision

选定方案：将 `SECURITY.md` 迁入 `docs/archive/retired-desktop-bridge/`，将 `task_plan.md` 迁入 `docs/archive/`。

核心理由：

1. `SECURITY.md` 的内容已经完全属于旧 Desktop Bridge，不该继续站在根目录代表项目当前安全面。
2. `task_plan.md` 是历史 scratch，不应继续占根目录位置。
3. archive 已经是项目处理历史资料的正式真相源，继续迁入最符合当前仓库协议。

## Plan

1. 迁移 `SECURITY.md`
   - 目标：`docs/archive/retired-desktop-bridge/SECURITY.md`
   - 验收：archive 内 desktop 文档链接仍可读

2. 迁移 `task_plan.md`
   - 目标：`docs/archive/task-plan-backend-control-plane.md`
   - 验收：根目录退出该文件

3. 更新 archive 索引
   - `docs/archive/README.md`
   - 验收：新增迁移记录

4. 验证
   - `npm run docs:check`

## Risks

1. 风险：archive 内相对链接断掉
   - 回滚：修 archive 内引用，不恢复根目录
2. 风险：`task_plan.md` 仍被某些人工习惯使用
   - 回滚：仅保留 archive 路径，不恢复根目录现役资格

（章节级）评审意见：[留空,用户将给出反馈]
