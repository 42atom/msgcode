# plan-260313-archive-retired-imsg-build-scripts

## Problem

`scripts/` 根目录仍然保留 `build-imsg.sh` 与 `verify-imsg.sh` 两个 retired iMessage 构建/校验脚本。它们和当前 Feishu-only 主链已经无关，继续留在正式脚本入口会污染仓库心智。

## Occam Check

- 不加它，系统具体坏在哪？
  - 运行时不会坏，但协作者仍会在 `scripts/` 根目录看到已经退役的 `imsg` 工具链，误判它还属于现役维护范围。
- 用更少的层能不能解决？
  - 能。直接迁入已有 `retired-imsg-runtime` archive，不新增任何兼容层。
- 这个改动让主链数量变多了还是变少了？
  - 变少了。正式脚本入口继续只保留当前主链需要的工具。

## Decision

选定方案：将两份 retired imsg 脚本迁入 `docs/archive/retired-imsg-runtime/scripts/`，并清理空的根 `recipes/` 目录。

核心理由：

1. `retired-imsg-runtime` 已经是该历史分支的正式 archive 真相源。
2. 根 `scripts/` 应继续只保留现役或仍有现实维护价值的脚本。
3. 空 `recipes/` 目录没有存在价值，保留只会制造噪声。

## Plan

1. 迁移脚本
   - `scripts/build-imsg.sh`
   - `scripts/verify-imsg.sh`
   - 目标：`docs/archive/retired-imsg-runtime/scripts/`

2. 更新 archive 文档
   - `docs/archive/retired-imsg-runtime/README.md`
   - `docs/archive/README.md`

3. 更新 changelog
   - `docs/CHANGELOG.md`

4. 删除空目录
   - 根 `recipes/`

5. 验证
   - `npm run docs:check`

## Risks

1. 风险：少量历史说明仍引用旧 `scripts/` 路径
   - 回滚：补 archive README 指向，不恢复根脚本入口
2. 风险：archive 真相源遗漏构建脚本
   - 回滚：将两份脚本纳回 archive，而不是恢复到根 `scripts/`

（章节级）评审意见：[留空,用户将给出反馈]
