# README 与贡献指南真相对齐

## Problem

代码主链已经完成多轮收口，但 README 体系还没完全跟上：最终方向没写清，`ghost-os` 地位偏弱，薄桥接边界没有在公开文档里说透，贡献者也缺少一份对外贡献指南来理解仓库边界。

## Occam Check

- 不加它，系统具体坏在哪？
  维护者会从 README 读到过时心智，继续把 legacy desktop 或自研识别逻辑当成现役方向。
- 用更少的层能不能解决？
  可以，直接修 README 与贡献指南，不加新文档体系。
- 这个改动让主链数量变多了还是变少了？
  变少了。公开文档与现役实现重新收口为一套说法。

## Decision

采用最小文档对齐方案：

1. 根 README 写清当前能力面与最终方向
2. `src/README.md` 强化 Tool Bus 单一真相源
3. `docs/README.md` 补充 `docs/` 与 `AIDOCS/` 的边界
4. 新增一份简洁 `CONTRIBUTING.md`

## Plan

1. 更新 `/Users/admin/GitProjects/msgcode/README.md`
2. 更新 `/Users/admin/GitProjects/msgcode/src/README.md`
3. 更新 `/Users/admin/GitProjects/msgcode/docs/README.md`
4. 新增 `/Users/admin/GitProjects/msgcode/CONTRIBUTING.md`
5. 更新 `/Users/admin/GitProjects/msgcode/docs/CHANGELOG.md`
6. 验证：
   - `npm run docs:check`

## Risks

- 风险：文案写得过重，反而引入新的口径漂移
  - 回滚：保留核心原则句，删掉多余背景描述
- 风险：未来方向写成实现承诺
  - 回滚：把措辞收回“方向/目标”，不写成现状

## 评审意见

[留空,用户将给出反馈]
