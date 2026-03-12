# Feishu 真实通道 BDD 验收集 v1

Issue: 0116

## Problem

当前仓库已经有两类测试：

1. 仓库内 BDD（`features/` + Cucumber）
2. 真实 Feishu 通道上的 live smoke / skill corpus

但还缺一层正式的“真实通道 BDD 验收集”：

- 仓库内 BDD 主要验证控制面、调度和局部行为
- live smoke 已经证明它能抓出 mock 看不到的问题
- 但没有一份冻结文档把“真实通道上的自然语言验收”定义成正式验收面

初版 smoke 先证明了这件事必须做：

- 自然语言浏览器任务通过
- 自然语言文件发送任务失败，暴露出“口头完成、没有真实文件发送”的缺口

后续复测又证明了这份验收集必须持续更新：

- 自然语言文件发送任务修复后已通过
- 失败恢复任务也已经拿到了同轮 `fail -> recover -> complete` 的真实证据

## Occam Check

1. 不加它，系统具体坏在哪？
   - 每次真实验收都临时想 prompt、临时解释结果，无法沉淀成可复用标准，也无法把失败项稳定挂进 backlog。
2. 用更少的层能不能解决？
   - 能。直接用一份文档化验收集收口，不加新平台、不加新控制面。
3. 这个改动让主链数量变多了还是变少了？
   - 变少了。把“最终验收到底看什么”收口成一套固定真实通道标准。

## Decision

采用 **“仓库内 BDD + 真实 Feishu 通道 BDD” 双层验收**。

分工明确：

- `features/` 里的 Cucumber BDD：
  - 用来锁仓库内行为、不变量、控制面和竞态
- `Feishu live BDD acceptance suite`：
  - 用来做最终验收
  - 必须使用真实群、真实自然语言、真实工具副作用、真实日志证据

这条真实通道 BDD 不取代 live verification loop，而是建立在它之上：

- `0098` 定义“怎么跑真实闭环”
- `0099` 定义“skill/live prompt 案例集”
- `0116` 定义“哪些真实自然语言 case 才算最终验收”

## Alternatives

### 方案 A：继续只靠现有 Cucumber BDD

- 优点：现成、稳定
- 缺点：抓不到真实通道上“口头完成、没有副作用”这类问题

### 方案 B：继续只靠临时 live smoke

- 优点：灵活
- 缺点：没有冻结验收标准，结果难比较、难复用

### 方案 C：冻结真实通道 BDD 验收集（推荐）

- 优点：最薄、最贴近生产、能直接挂当前真实缺口
- 缺点：执行比仓库内 BDD 慢，需要真实群和 bot

## Scope

v1 只覆盖最值钱的主链场景：

1. 自然语言网页信息收集
2. 自然语言文件回传
3. 自然语言基础问答/路由
4. 自然语言失败后恢复

不追求一次性覆盖全部 skill。

## Plan

1. 新建 issue / plan，冻结 `Feishu live BDD acceptance suite` 定义
2. 在 [AIDOCS/prompts/feishu-live-bdd-acceptance-suite-v1.md](/Users/admin/GitProjects/msgcode/AIDOCS/prompts/feishu-live-bdd-acceptance-suite-v1.md) 中：
   - 写明场景
   - 写明证据口径
   - 写明当前通过/失败状态
3. 把当前真实场景的失败基线和修复复测都写进正式验收集
4. 运行：
   - `npm run bdd`
   - `npm run docs:check`

## Risks

### 风险 1：把 live smoke 和正式验收继续混在一起

回滚/降级：
- 明确文档分工：`0098` 是方法，`0099` 是案例池，`0116` 是正式验收集

### 风险 2：只写某一时刻的结果，不持续更新真实状态

回滚/降级：
- v1 必须显式保留失败基线，并在修复后补写通过态，不允许只留聊天记忆

### 风险 3：以后又退回“聊天记忆式验收”

回滚/降级：
- 后续凡真实验收讨论，统一引用本 Plan 和 suite 文档

（章节级）评审意见：[留空,用户将给出反馈]
