# plan-260313-retire-memory-remember-status-aliases

## Problem

`memory remember/status` 还在 CLI 解析期静默映射到 `memory add/stats`，同时 `help-docs` 继续暴露 alias 字段。

这会保留一层不可见但真实可执行的历史词法兼容面，和当前“正式合同、公开帮助、direct invoke 都尽量围绕单一 canonical 主链”的收口方向相冲突。

## Occam Check

### 不加它，系统具体坏在哪？

- `memory remember/status` 会继续 silently succeed
- 模型和维护者仍会面对一套 help 不可见、但执行能成功的隐形入口

### 用更少的层能不能解决？

- 能。删除 CLI 解析期 alias 改写，改为隐藏 retired 子命令

### 这个改动让主链数量变多了还是变少了？

- 变少了。正式可执行主链只剩 `memory add/stats`

## Decision

选定方案：保留 `msgcode memory add/stats` 作为唯一正式 memory 写入/统计入口；`remember/status` 改为隐藏 retired 子命令，只保留显式迁移提示。

核心理由：

1. `remember/status` 没有新增能力，只是旧词法别名
2. 显式 retired 提示比静默归一化更符合“程序是真合同”
3. `memory --help`、`help-docs --json`、direct invoke 三个面将重新一致

## Plan

1. 更新 `src/cli.ts`
   - 停止把 `memory remember/status` 静默映射到 canonical 主链

2. 更新 `src/cli/memory.ts`
   - 新增隐藏 retired 子命令 `remember` / `status`
   - `createMemoryCommand()` 只在 direct invoke 层保留兼容入口，`memory --help` 继续隐藏
   - 删除 `getMemoryAddContract()` / `getMemoryStatsContract()` 中的 alias 字段

3. 更新测试
   - `test/p5-7-r4-1-memory-contract.test.ts`
   - `test/p5-7-r4-t1-smoke-verification.test.ts`

4. 更新 changelog 与 issue notes

## Risks

1. 历史脚本仍调用 `memory remember/status`
   回滚/降级：保留 retired 提示；不要恢复静默 alias

## Test Plan

- `msgcode memory --help` 不出现 `remember/status`
- `msgcode memory remember ... --json` 返回 retired 错误
- `msgcode memory status --json` 返回 retired 错误
- `help-docs --json` 中 `memory add/stats` 合同不再带 alias 字段

（章节级）评审意见：[留空,用户将给出反馈]
