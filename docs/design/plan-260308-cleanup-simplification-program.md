# Plan: 清理简化专项

Issue: 0045

## Problem

当前分支运行时主链已经明显收口，但工作区仍残留大量中间草稿、未提交的技能文案整理结果和历史残影。继续在这种状态下推进，会让后续任务持续建立在“混合上下文”上，导致判断成本和误操作风险都升高。

## Occam Check

### 1. 不加这次改动，系统具体坏在哪？

不会立刻把运行时打坏，但会持续制造认知负担：执行同学、验收同学和后续自己都会分不清哪些文件仍是正式真相源，哪些只是已经被后续工作覆盖的中间草稿。

### 2. 用更少的层能不能解决？

能。只做文件分类、草稿收口和技能文案整理结果提交，不新增任何运行时层、控制层、编排层。

### 3. 这个改动让主链数量变多了还是变少了？

会变少。目标是减少“同一主题多份中间文档同时漂浮”的状态，把工作区收回到少量明确改动。

## Decision

采用“只清认知噪音，不动运行时主链”的最小清理方案。

核心理由：

1. 当前最值钱的是降低后续决策成本，而不是继续在脏工作区上叠新功能
2. runtime skills 文案整理结果已经成型，适合先独立收口
3. 多份未跟踪草稿若继续漂着，会反复误导后续计划与验收

## Plan

1. 盘点工作区
   - 列出已修改 / 未跟踪文件
   - 按“正式保留 / 历史草稿 / 暂不处理”分类
2. 先收 runtime skill 整理结果
   - `src/skills/runtime/scheduler/SKILL.md`
   - `src/skills/runtime/patchright-browser/SKILL.md`
   - `src/skills/runtime/pinchtab-browser/SKILL.md`
   - `src/skills/runtime/index.json`
   - `src/skills/README.md`
   - 对应 tests
3. 处理 issue/plan 草稿
   - 逐个判断未跟踪 `issues/0031+`、`plan-260308-*` 是否仍是正式真相源
   - 已被后续 issue/plan 覆盖的，标记为 superseded 或直接不纳入本轮提交
4. 输出专项结果清单
   - 保留提交项
   - 留待后续项
   - 丢弃/忽略项
5. 若本轮形成对外可见清理结果，更新 changelog；否则只更新 issue notes

## Risks

1. 误把仍有价值的中间文档当垃圾清掉
   - 回滚/降级：不直接删除，优先通过 issue 记录其已被谁覆盖，必要时保留但不提交
2. 把与当前专项无关的运行时改动混进提交
   - 回滚/降级：先做文件分类，再最小 `git add`
3. 清理过程中重新扩 scope 到架构或功能
   - 回滚/降级：本专项只清文件和口径，不动运行时逻辑

## Test Plan

1. runtime skill 相关测试：
   - `test/p5-7-r13-runtime-skill-sync.test.ts`
   - `test/p5-7-r17-scheduler-pointer-only.test.ts`
2. 若只做文档/清理决策，不额外扩大运行时测试范围

## Observability

1. 本专项主要以 `git status`、提交边界和 issue notes 作为可观测证据
2. 不新增运行时日志

（章节级）评审意见：[留空,用户将给出反馈]
