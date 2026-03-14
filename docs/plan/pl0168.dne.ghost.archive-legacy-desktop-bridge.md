# plan-260313-archive-legacy-desktop-bridge

## Problem

legacy desktop bridge 虽然已经退出运行时主链，但 `mac/`、`docs/desktop/`、`scripts/desktop/`、`recipes/desktop/` 仍然停留在现役目录树里。这样会继续污染仓库心智，让协作者误判还有第二套桌面主链。

## Occam Check

- 不加它，系统具体坏在哪？
  - 运行时不会立刻坏，但仓库结构会持续暗示“legacy desktop 仍是现役的一部分”，协作与维护成本都会继续被拉高。
- 用更少的层能不能解决？
  - 能。直接迁入版本化 archive，不加任何新控制层或兼容层。
- 这个改动让主链数量变多了还是变少了？
  - 变少了。现役目录树只保留 `ghost_*` 主链，legacy bridge 从主路径退出。

## Decision

选定方案：将整套 legacy desktop bridge 资产迁入 `docs/archive/retired-desktop-bridge/`。

核心理由：

1. 做薄不仅是删执行层，也包括删目录层面的双主链暗示。
2. archive 比 `.trash` 更适合承载这类仍需版本化追溯的历史快照。
3. 迁移而非删除，能同时满足“仓库干净”与“历史可查”。

## Plan

1. 创建 archive 目标目录
   - `docs/archive/retired-desktop-bridge/`
   - 包含 `mac/`、`docs/desktop/`、`scripts/desktop/`、`recipes/desktop/`

2. 迁移 legacy 目录
   - `mac/`
   - `docs/desktop/`
   - `scripts/desktop/`
   - `recipes/desktop/`

3. 更新现役入口
   - `README.md`
   - `docs/README.md`
   - `docs/archive/README.md`
   - `package.json`
   - 验收：现役入口只指向 archive，不再直接暴露 legacy desktop smoke

4. 更新 ignore 与 changelog
   - `.gitignore`
   - `docs/CHANGELOG.md`

5. 验证
   - `npm run docs:check`

## Risks

1. 风险：archive 迁移后遗留 build 产物污染工作树
   - 回滚：补 archive 路径下的 ignore 规则，不把 `.build` 当正式变更提交
2. 风险：少量活动文档仍引用旧路径
   - 回滚：继续补现役导航路径，不恢复原目录

（章节级）评审意见：[留空,用户将给出反馈]
