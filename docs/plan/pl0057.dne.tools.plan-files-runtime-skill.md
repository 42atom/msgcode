# file-first planning runtime skill

## Problem

当前 `msgcode` 运行时没有正式的 planning skill。已有 `/task` 和 `TaskSupervisor` 负责长任务状态与续跑，但不负责“先用文件做任务内规划”。外部已有 `planning-with-files` 可借鉴，Alma 也有 `plan-mode`，但后者本质是控制层开关，不符合 `msgcode` “做薄、用说明书增强模型、不新增模式层”的原则。

## Occam Check

- 不加它，系统具体坏在哪？
  复杂任务缺少正式的 file-first 规划说明书，模型只能临时猜怎么建计划文件，容易与 memory、/task 和仓库 issue/plan 协议混淆。
- 用更少的层能不能解决？
  能。只增加一个 runtime skill 文档和索引入口，不加 `/plan` 命令、不加 mode、不加 supervisor。
- 这个改动让主链数量变多了还是变少了？
  变少了。planning 不再分散在外部 skill、口头约定和个人记忆里，而是收口到一份正式 runtime skill。

## Decision

采用 `plan-files` runtime skill，作为 file-first planning 的官方说明书：

1. 复杂任务时，模型可用任务内文件做工作记忆
2. `plan` 与 `memory` 严格分离：`plan` 是 task-local，`memory` 是 cross-task
3. 任务监督不新增新层，仍由模型自检或既有 `/task`

不采用 Alma `plan-mode`，也不原样照搬 `planning-with-files` 的 “永远先建三文件” 规则。`msgcode` 版本强调最小可删：默认一份计划文件即可，`notes` 与最终交付文件按需再加。

## Plan

1. 新增 [plan-files/SKILL.md](/Users/admin/GitProjects/msgcode/src/skills/runtime/plan-files/SKILL.md)
2. 更新 [index.json](/Users/admin/GitProjects/msgcode/src/skills/runtime/index.json)
3. 更新 [README.md](/Users/admin/GitProjects/msgcode/src/skills/README.md)
4. 更新测试：
   - [p5-7-r13-runtime-skill-sync.test.ts](/Users/admin/GitProjects/msgcode/test/p5-7-r13-runtime-skill-sync.test.ts)
5. 同步运行时 skills，重启 daemon
6. 更新 [CHANGELOG.md](/Users/admin/GitProjects/msgcode/docs/CHANGELOG.md) 与 issue

## Risks

- 风险低：本轮只增加文档型 runtime skill，不改执行核
- 主要风险是文案边界写模糊，导致模型把 planning 当成 memory 或 supervisor
- 回滚：删除 `plan-files` runtime skill 目录、移除 `index.json` 条目，并回退 README / 测试 / CHANGELOG

评审意见：[留空,用户将给出反馈]
