# 发布版本统一升级到 2.4.0

## Problem

当前仓库的现役版本口径仍停在 `2.3.0`，而 `docs/release/` 里同时保留历史 `v1.0.x` 里程碑文档，容易让“当前版本”和“历史发布记录”混淆。需要把现役发布面统一升级到 `2.4.0`，但不能篡改历史 release。

## Occam Check

- 不加它，系统具体坏在哪？
  当前包版本、release 索引和现役发布文档不一致，用户看到 release 面时会误判当前代际。
- 用更少的层能不能解决？
  可以，直接改现有 package/release/changelog 口径，不新增任何版本管理层。
- 这个改动让主链数量变多了还是变少了？
  变少了。当前发布真相源收口到 `package + docs/release + docs/CHANGELOG`。

## Decision

采用最小版本升级方案：

1. 将现役包版本从 `2.3.0` 升到 `2.4.0`
2. 新增 `docs/release/v2.4.0.md` 作为当前 release 文档
3. 更新 release 索引与 changelog
4. 历史 `v1.0.x` 仅保留为历史记录，不做“统一改写”

关键理由：

- 统一当前口径，不重写历史
- 不引入新的发布流程或中间层
- 保持 release 面简单可追溯

## Plan

1. 更新 `/Users/admin/GitProjects/msgcode/package.json`
2. 更新 `/Users/admin/GitProjects/msgcode/package-lock.json`
3. 更新 `/Users/admin/GitProjects/msgcode/src/runners/ghost-mcp-client.ts`
4. 新增 `/Users/admin/GitProjects/msgcode/docs/release/v2.4.0.md`
5. 更新 `/Users/admin/GitProjects/msgcode/docs/release/README.md`
6. 更新 `/Users/admin/GitProjects/msgcode/docs/CHANGELOG.md`
7. 视需要更新现役文档里的当前版本引用
8. 验证：
   - `npx tsc --noEmit`
   - `npm run docs:check`

## Risks

- 风险：把历史 release 文档误当现役口径一起改写
  - 回滚：只回退 `2.4.0` 新增和 package/changelog 版本修改，保留历史文件不动
- 风险：遗漏现役版本引用，导致口径分叉
  - 回滚：补充修正遗漏引用，不需要回滚整体方案

## 评审意见

[留空,用户将给出反馈]
