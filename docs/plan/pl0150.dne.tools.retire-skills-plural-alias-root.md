# plan-260313-retire-skills-plural-alias-root

## Problem

`skill` 已经是 retired compat shell，但 `skills` 仍通过 CLI 解析期归一化和 commander alias 映射到同一命令。

这虽然不再执行业务逻辑，却继续保留一层多余词法兼容面。

## Occam Check

### 不加它，系统具体坏在哪？

- `skill` / `skills` 两套根词继续并存
- 维护者仍要面对“只是退役壳，为什么还保留 alias”的低价值分叉

### 用更少的层能不能解决？

- 能。保留 `skill` retired 壳，把 `skills` 改为独立 retired compat root

### 这个改动让主链数量变多了还是变少了？

- 变少了。删掉的是 alias 和静默归一化，不是新增执行主链

## Decision

选定方案：停止 `skills -> skill` 静默映射与 commander alias，把 `skills` 改为独立 retired compat root。

核心理由：

1. `skills` 没有新增能力
2. 显式 retired root 比 alias 更符合“程序是真合同”
3. `skill` 与 `skills` 的 direct invoke 都会保持同一类迁移提示，但不再靠隐式映射

## Plan

1. 更新 `src/cli.ts`
   - 删除 `skills -> skill` 静默归一化
   - `top === "skills"` 时单独加载 retired compat root

2. 更新 `src/cli/skills.ts`
   - 删除 `.alias("skills")`
   - 新增 `createSkillsRetiredCommand()`

3. 更新测试
   - `test/p5-7-r34-skill-cli-retired.test.ts`

## Risks

1. 历史脚本仍调用 `skills`
   回滚/降级：保留 retired 提示；不要恢复 alias

## Test Plan

- `msgcode skill run demo` 返回 retired 提示
- `msgcode skills run demo` 返回 retired 提示
- root help 不公开 `skill/skills`

（章节级）评审意见：[留空,用户将给出反馈]
