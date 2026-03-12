# plan-260313-retire-browser-gmail-readonly-compat-entry

## Problem

`browser gmail-readonly` 已经退出公开合同，但 compat 入口仍可 direct invoke 并执行真实 Gmail 业务流。

这会继续制造“虽然不公开，但系统还偷偷支持它”的双口径。

## Occam Check

### 不加它，系统具体坏在哪？

- 历史 Gmail 只读业务流仍作为隐藏可执行入口存活
- 公开合同与执行面继续分叉

### 用更少的层能不能解决？

- 能。保留 CLI 解析期映射，但 compat 命令本身直接退役

### 这个改动让主链数量变多了还是变少了？

- 变少了。删掉的是历史业务 compat 执行链

## Decision

选定方案：`browser gmail-readonly` / `browser-gmail-readonly` 不再执行真实 Gmail 只读验收，只返回 retired 提示。

核心理由：

1. 这已经不是当前 browser core 的正式能力
2. 历史任务与测试都已归档，不应继续保留活入口
3. 保留显式 retired 提示足够照顾旧调用方

## Plan

1. 更新 `src/cli/browser.ts`
   - 去掉 compat 入口里的真实执行链
   - 改为 retired compat shell

2. 保留 `src/cli.ts` 里的 legacy 参数映射
   - `browser gmail-readonly -> browser-gmail-readonly`
   - 但目标命令只做 retired 提示

3. 更新测试
   - `test/p5-7-r7a-browser-contract.test.ts`

## Risks

1. 历史脚本仍在调用 Gmail readonly compat 入口
   回滚/降级：保留 retired 提示；不要恢复业务执行链

## Test Plan

- `msgcode browser --help` 仍不含 `gmail-readonly`
- `msgcode help-docs --json` 仍不含 `msgcode browser gmail-readonly`
- `msgcode browser gmail-readonly --json` 返回 retired 错误
- `msgcode browser-gmail-readonly --json` 返回 retired 错误

（章节级）评审意见：[留空,用户将给出反馈]
