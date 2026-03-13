# AIDOCS 分层整理为 active 与 archive

## Problem

`AIDOCS/` 现在混合了现役 review 输入、历史评审、一次性 live 报告和旧阶段设计稿。人和 agent 检索时，很难直接判断哪些是当前真相源，哪些只是历史沉淀。

## Occam Check

- 不加它，系统具体坏在哪？
  `AIDOCS/` 会持续堆积，后续检索 review/report 时会被过时文档污染，增加误读和误引用概率。
- 用更少的层能不能解决？
  可以，只给 `reviews/reports` 加 `active/archive` 两层，不重构整个 `AIDOCS`。
- 这个改动让主链数量变多了还是变少了？
  变少了。现役输入和历史档案分离后，当前可读主线更短。

## Decision

采用最小分层整理方案：

1. 只整理 `AIDOCS/reviews` 与 `AIDOCS/reports`
2. 建 `active/archive` 两层
3. 先归档明显过时、低引用或一轮性草稿
4. 仍被 issue/plan 大量引用的 tracked 文件暂留原位，避免大面积改链

## Plan

1. 新增 `/Users/admin/GitProjects/msgcode/AIDOCS/README.md`
2. 新增：
   - `/Users/admin/GitProjects/msgcode/AIDOCS/reviews/active/`
   - `/Users/admin/GitProjects/msgcode/AIDOCS/reviews/archive/20260313/`
   - `/Users/admin/GitProjects/msgcode/AIDOCS/reports/active/`
   - `/Users/admin/GitProjects/msgcode/AIDOCS/reports/archive/20260313/`
3. 移动一批 review/report：
   - 当前仍有价值但未正式固化的，进 `active`
   - 明显过时、一次性、无引用的，进 `archive/20260313`
4. 必要时更新引用
5. 更新 `/Users/admin/GitProjects/msgcode/docs/CHANGELOG.md`
6. 验证：
   - `npm run docs:check`

## Risks

- 风险：搬动仍被 issue/plan 引用的 tracked 文件
  - 回滚：优先只移动无引用和 untracked 文件；若误动，立即回退或补路径引用
- 风险：整理过度，扩大到整个 `AIDOCS`
  - 回滚：把范围收回 `reviews/reports`，其余保持不动

## 评审意见

[留空,用户将给出反馈]
