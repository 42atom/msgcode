# legacy-active skills 与生成产物路径清理方案

## Problem

当前 skill 体系已经收口到 `runtime / optional / legacy-active / retired` 的现实状态，但 `legacy-active` 还没有被正式审计与分类。同时，生成类 skill 的输出目录口径曾出现 `artifacts/...` 与 `AIDOCS/...` 并存，导致模型对生成产物位置判断不稳定。

## Occam Check

- 不加它，系统具体坏在哪？
  后续仍会反复出现“skill 还在用却被当成废弃清掉”和“同一类生成产物到底该去哪里找”的复发型故障。
- 用更少的层能不能解决？
  能。先做分类和文案收口，不做新分层平台。
- 这个改动让主链数量变多了还是变少了？
  变少了。把隐含的 legacy-active 与路径双真相源显式收口成单一路径与明确分类。

## Decision

先做一轮 reviewer 式清理：

1. 审计 legacy-active skills 的真实使用面
2. 把确认仍在主线使用的 skill 正式升格进 repo `runtime`
3. 收口生成类 skill 输出目录到 `AIDOCS/`

不立即平台化 skill 管理，不恢复 `managed` 层，也不继续让关键 skill 靠用户目录残留活着。

## Plan

- 审计 `~/.config/msgcode/skills/` 与 repo `runtime/optional` 的差集
- 结合日志与运行时发现路径，判断哪些仍在活跃使用
- 将 `memory/file/thread/todo/media/gen/banana-pro-image-gen` 升格进 repo `src/skills/runtime/`
- 对 `banana-pro-image-gen` 的输出目录合同统一到 `AIDOCS/banana-images`
- 更新同步锁和技能目录说明，确保这些能力不再依赖本地残留

## Risks

- 风险 1：误把仍在使用的 skill 当成 retired
  - 回滚：保留 `.trash` 恢复路径，不做物理删除
- 风险 2：只修文案，不修真实脚本输出
  - 回滚：先以真实脚本为真相源，文案跟随脚本，不反过来猜
- 风险 3：顺手把 skill 管理平台化
  - 回滚：严格限制本轮只做分类与路径收口，不新增层

评审意见：[留空,用户将给出反馈]
