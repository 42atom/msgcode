# plan-260313-remove-last-normalize-legacy-cli-shims

## Problem

`normalizeLegacyCliArgs()` 里还留着两条历史兼容改写，把：

- `browser gmail-readonly`
- `file send`

先重写成 retired compat root，再返回退役提示。

这虽然不再是偷偷成功的业务 fallback，但仍然是多余的 CLI 预处理层。

## Occam Check

### 不加它，系统具体坏在哪？

- CLI 启动链里仍保留一层“先改写再退役”的 shim
- 历史子命令的退役提示不由各自命令域自身处理

### 用更少的层能不能解决？

- 能。把退役提示直接下沉到 `browser` / `file` 的隐藏子命令里

### 这个改动让主链数量变多了还是变少了？

- 变少了。删掉的是 CLI 预处理 shim

## Decision

选定方案：删除 `normalizeLegacyCliArgs()` 里最后两条兼容改写，并在 `browser` / `file` 域内部增加隐藏 retired 子命令承接 direct invoke。

核心理由：

1. 退役提示应由对应命令域自己负责，而不是靠 root 预处理转发
2. `browser --help` / `file --help` 可继续保持干净
3. 这样可以把 `normalizeLegacyCliArgs()` 收到空实现

## Plan

1. 更新 `src/cli.ts`
   - 删除 `browser gmail-readonly` 与 `file send` 改写

2. 更新 `src/cli/browser.ts`
   - 新增隐藏 `gmail-readonly` retired 子命令

3. 更新 `src/cli/file.ts`
   - 新增隐藏 `send` retired 子命令

4. 更新测试
   - `test/p5-7-r7a-browser-contract.test.ts`
   - `test/p5-7-r1-file-send.test.ts`

## Risks

1. commander 对隐藏子命令的解析行为与现状不同
   回滚/降级：保留 retired root，不恢复 normalize shim

## Test Plan

- `msgcode browser gmail-readonly --json` 返回 retired 错误
- `msgcode browser --help` 不公开 `gmail-readonly`
- `msgcode file send --json` 返回 retired 错误
- `msgcode file --help` 不公开 `send`

（章节级）评审意见：[留空,用户将给出反馈]
