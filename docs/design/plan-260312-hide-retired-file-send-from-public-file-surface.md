# plan-260312-hide-retired-file-send-from-public-file-surface

## Problem

`file send` 已被收口为 retired 壳，也已从 `help-docs --json` 正式合同移除，但 `msgcode file --help` 仍然公开它。这会让人类 help 与机器合同继续分叉。

## Occam Check

### 1. 不加它，系统具体坏在哪？

- 公开 `file --help` 会继续暗示 `send` 是现役子命令
- 与 `help-docs` 的 retired 口径冲突

### 2. 用更少的层能不能解决？

- 能。像 `browser gmail-readonly` 一样，把 `file send` 退成 direct invoke compat 即可
- 不需要删行为，也不需要新增层

### 3. 这个改动让主链数量变多了还是变少了？

- 变少了。它消灭的是 `help-docs` 和 `file --help` 双口径

## Decision

推荐方案：**`file send` 退出 `file` 公开子命令面，保留为 direct invoke compat shell。**

## Plan

1. 在 `src/cli.ts` 里把 `file send ...` 归一化到 `file-send ...`
2. 在 `src/cli/file.ts` 中：
   - `createFileCommand()` 不再公开 `send`
   - 新增 compat 命令 `createFileSendCompatCommand()`
3. 补测试并更新文档

## Risks

- 风险低
- 回滚：恢复 `createFileCommand()` 中的 `send` 子命令并移除 compat 映射

## 评审意见

[留空,用户将给出反馈]
