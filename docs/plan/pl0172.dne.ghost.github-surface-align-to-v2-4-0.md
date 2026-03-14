# GitHub 展示面统一到 v2.4.0 与 ghost 主链

## Problem

仓库内部已经切到 `v2.4.0` 与 `ghost_*` 桌面主链，但 GitHub 首页和 workflow 仍残留 legacy Desktop Bridge 叙事。尤其 `.github/workflows/desktop-smoke.yml` 还在调用已经归档的路径，会把外部展示面带回旧主链。

## Occam Check

- 不加它，系统具体坏在哪？
  GitHub 首页和 Actions 会继续对外传达错误主线，外部读者会误以为 legacy desktop 仍是现役能力面。
- 用更少的层能不能解决？
  可以，直接改 README 并退役旧 workflow，不新增任何发布控制层。
- 这个改动让主链数量变多了还是变少了？
  变少了。GitHub 展示面与仓库现役主链重新收口为一条。

## Decision

采用最小 GitHub 面收口方案：

1. README 首屏明确当前版本 `v2.4.0`
2. README 明确当前桌面能力面为 `ghost_*`
3. 将 legacy `desktop-smoke` workflow 迁出 `.github/workflows/`
4. 通过 changelog 记录这次对外展示面的收口

## Plan

1. 更新 `/Users/admin/GitProjects/msgcode/README.md`
2. 将 `/Users/admin/GitProjects/msgcode/.github/workflows/desktop-smoke.yml` 迁出主 workflow 目录
3. 更新 `/Users/admin/GitProjects/msgcode/docs/CHANGELOG.md`
4. 更新 issue 状态与 notes
5. 运行 `npm run docs:check`

## Risks

- 风险：GitHub 上缺少一个桌面 smoke workflow
  - 回滚：把 workflow 从归档位置迁回 `.github/workflows/`
- 风险：README 首屏写得过重，反而增加噪音
  - 回滚：保留版本与主链一句话声明，删掉其余累赘文案

## 评审意见

[留空,用户将给出反馈]
