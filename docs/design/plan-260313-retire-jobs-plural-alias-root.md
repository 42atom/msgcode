# plan-260313-retire-jobs-plural-alias-root

## Problem

`job` 已经是正式 canonical 根入口，但 `jobs` 仍可 direct invoke，并在 CLI 解析期静默归一化。

这虽然不是双实现，却仍是双命名，继续增加一层不必要兼容面。

## Occam Check

### 不加它，系统具体坏在哪？

- `job` / `jobs` 两套根词继续并存
- 维护者与模型继续面对“哪个才是真正根入口”的低价值分叉

### 用更少的层能不能解决？

- 能。只保留 `job`，把 `jobs` 改成 retired 提示

### 这个改动让主链数量变多了还是变少了？

- 变少了。删掉的是复数 alias 根入口

## Decision

选定方案：保留 `msgcode job ...` 作为唯一正式任务根入口，`jobs` 改为 retired compat 提示。

核心理由：

1. `jobs` 没有提供新能力
2. 当前 CLI 已经在朝单一 canonical 根命令收口
3. 显式提示比静默归一化更符合“程序是真合同”

## Plan

1. 更新 `src/cli.ts`
   - 停止把 `jobs` 静默映射到 `job`
   - direct invoke `jobs` 时加载 retired compat root

2. 更新 `src/cli/jobs.ts`
   - 新增 `createJobsRetiredCommand()`

3. 更新测试
   - `test/p5-7-r6-hotfix-gen-entry-tools-default.test.ts`

## Risks

1. 历史脚本仍在调用 `jobs`
   回滚/降级：保留 retired 提示；不要恢复静默 alias

## Test Plan

- `msgcode job --help` 正常
- `msgcode jobs --help` 显示 retired 提示
- `msgcode jobs run xxx` 返回 retired 错误

（章节级）评审意见：[留空,用户将给出反馈]
