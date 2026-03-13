# plan-260313-mac-legacy-surface-freeze

## Problem

`ghost_*` 已经成为唯一现役桌面能力面，但 `mac/`、`docs/desktop/`、`package.json` 仍然保留“Desktop Bridge 还是当前入口”的文案与脚本命名。这样会让协作者继续把 legacy 桥当成默认心智，而不是一个待删除的历史区。

## Occam Check

- 不加它，系统具体坏在哪？
  - 代码主链不会立刻坏，但协作者会继续沿着 `mac/`、`docs/desktop/`、`desktop:smoke` 这套旧叙事走，形成新的历史债。
- 用更少的层能不能解决？
  - 能。只改文档导航与脚本命名，不加新控制层，也不碰执行主链。
- 这个改动让主链数量变多了还是变少了？
  - 变少了。它继续削弱 legacy `desktop` 的心智主链，只保留 `ghost_*` 现役叙事。

## Decision

选定方案：执行“第一刀文档降级与默认心智摘除”。

核心理由：

1. 现在最值钱的是冻结心智，而不是急着物理删目录。
2. 旧桥已经退出主链，文档和脚本命名也该一起退。
3. 只做 legacy 标记和入口改名，就能明显降低误用，不需要新增任何结构。

## Plan

1. 更新 `mac/README.md`
   - 顶部新增 `[DEPRECATED] / legacy` 警告
   - 明确 `ghost_*` 才是现役桌面能力面

2. 更新 `docs/desktop/README.md`
   - 顶部改成 legacy 历史文档说明
   - 明确不再作为现役上手文档

3. 更新导航文档
   - `docs/desktop/contract.md`
   - `docs/desktop/recipe-dsl.md`
   - `docs/README.md`
   - `README.md`
   - 验收：都不再把旧 Desktop Bridge 叙述为现役入口

4. 修改 `package.json`
   - `desktop:smoke` 改名为 `legacy:desktop:smoke`
   - 验收：默认脚本名不再暗示现役桌面主链

5. 更新 `docs/CHANGELOG.md`
   - 记录这是外部可见口径变化

6. 验证
   - `npm run docs:check`

## Risks

1. 风险：文档降级不够明确，协作者仍把 legacy 桥当现役
   - 回滚：继续加强顶层墓碑提示，但不扩大到物理删除
2. 风险：脚本改名影响少量手工习惯
   - 回滚：保留 legacy 名称即可，不恢复为默认 `desktop:*` 心智

（章节级）评审意见：[留空,用户将给出反馈]
