# plan-260313-ban-history-debt-inheritance-and-purge-cli-tombstones

## Problem

当前仓库虽然已经把多数历史命令从 prompt、help-docs 和公开帮助中移走，但实现里还残留很多 retired compat shell 和 hidden retired subcommand。

这类代码不再提供真实能力，只是在为死命令保留一条“体面失败”的执行路径，继续让历史债务占据系统结构。

## Occam Check

### 不加它，系统具体坏在哪？

- 死命令继续拥有 `Command` 节点、错误码、提示文案和测试保护
- 命令树继续背着一批不服务主链的 tombstone

### 用更少的层能不能解决？

- 能。直接删除 tombstone，让 commander 返回原生 `unknown command`

### 这个改动让主链数量变多了还是变少了？

- 变少了。删掉的是历史死命令的结构占位

## Decision

选定方案：把“不要用面向对象的方式去继承历史债务”写入仓库规则，并删除 retired CLI tombstone。

核心理由：

1. 死命令不应继续拥有结构化实现
2. 原生 parser 错误已经足够表达“命令不存在”
3. 代码结构应该只服务现役主链，而不是给历史遗留修墓碑

## Plan

1. 更新 `AGENTS.md`
   - 写入新铁律与执行口径

2. 更新 `src/cli.ts`
   - 删除 retired root 装载函数与分支
   - 删除空壳 `normalizeLegacyCliArgs()`

3. 更新 active CLI 模块
   - `src/cli/browser.ts`
   - `src/cli/memory.ts`
   - `src/cli/jobs.ts`
   - `src/cli/gen-image.ts`
   - `src/cli/gen-audio.ts`

4. 移走纯 tombstone 文件
   - `src/cli/file.ts`
   - `src/cli/system.ts`
   - `src/cli/web.ts`
   - `src/cli/media.ts`
   - `src/cli/skills.ts`

5. 更新测试
   - 改成 unknown command 断言

## Risks

1. 历史脚本会从“显式退役提示”变成“unknown command”
   回滚/降级：如果真有不可忽略证据，再单独评估迁移工具；默认不恢复 tombstone

## Test Plan

- `msgcode file send --json` 返回 unknown command
- `msgcode browser gmail-readonly --json` 返回 unknown command
- `msgcode memory remember ... --json` 返回 unknown command
- `msgcode gen-image --help`、`msgcode jobs --help`、`msgcode skill --help` 返回 unknown command
- `help-docs --json` 与 root help 继续只暴露现役命令

（章节级）评审意见：[留空,用户将给出反馈]
