# plan-260313-retire-web-cli-wrappers

## Problem

`web search` 与 `web fetch` 当前仍作为 msgcode 公开 CLI 能力存在，但本质上只是对上游网络能力的命令行转述：

- `web search` -> MCP `web_search`
- `web fetch` -> `webReader`

它们没有形成 msgcode 特有的长期状态、权限桥接或运行时管理边界，继续保留只会增加一层多余合同。

## Occam Check

### 不加它，系统具体坏在哪？

- `web` 会继续作为一组二手 CLI 壳留在公开合同里
- 模型和用户需要多认识一层 `msgcode web` 方言

### 用更少的层能不能解决？

- 能。直接退役 `web` domain，不新增替代层

### 这个改动让主链数量变多了还是变少了？

- 变少了。删掉的是 CLI 包装层

## Decision

选定方案：退役 `web search/fetch` 公开 CLI 包装层，direct invoke 仅保留显式 retired 提示。

核心理由：

1. 它们不是 msgcode 独有桥接边界
2. 与前两刀的“删二手壳”标准一致
3. 一次收整个 `web` domain，比单独留下 `search` 或 `fetch` 更干净

## Plan

1. 更新 `src/cli/web.ts`
   - 收口为 retired compat shell
2. 更新 `src/cli.ts`
   - root help 不再公开 `web`
3. 更新 `src/cli/help.ts`
   - `help-docs --json` 不再导出 `web search/fetch`
4. 更新测试并验证

## Risks

1. 历史脚本仍调用 `msgcode web`；回滚/降级：保留 retired compat 提示，不恢复公开合同

## Test Plan

- `msgcode --help` 不含 `web`
- `msgcode help-docs --json` 不含 `web search/fetch`
- `msgcode web search --q foo` 返回 retired 提示
- `msgcode web fetch --url https://example.com` 返回 retired 提示

（章节级）评审意见：[留空,用户将给出反馈]
