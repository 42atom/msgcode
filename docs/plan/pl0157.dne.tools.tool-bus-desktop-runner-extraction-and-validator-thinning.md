# plan-260313-tool-bus-desktop-runner-extraction-and-validator-thinning

## Problem

`src/tools/bus.ts` 里仍然混着两类不属于薄网关的东西：一类是 `desktop` 的完整执行适配与历史 `subcommand` 兼容主链，另一类是 `validateToolArgs()` 里对 `browser` 的厚手写前置裁判。它们都在替真实执行层做决定，让总线继续承担历史债和重复校验。

## Occam Check

### 不加它，系统具体坏在哪？

- bus 继续同时维护 `desktop RPC` 与 `desktop subcommand` 两条主链
- `DesktopSessionPool`、desktopctl 查找与 artifact 解析继续挤在总线核心
- `browser` 参数校验继续在 bus 和 runner 双份存在

### 用更少的层能不能解决？

- 能。删掉 `desktop` 旧 compat 主链，只保留 `method + params`
- 将 desktop 执行适配收成单一 runner
- 删除 `browser` 的重复前置裁判，让 runner 返回真实 bad args

### 这个改动让主链数量变多了还是变少了？

- 变少了。desktop 从两条主链收成一条，browser 也少一层前置裁判

## Decision

选定方案：`desktop` 在 Tool Bus 中只保留 `method + params` 的最小入口；session / desktopctl / artifact 处理迁到 `src/runners/desktop.ts`。`validateToolArgs()` 仅保留总线层最小必需校验，删除 `browser` 的 per-operation 手写裁判。

核心理由：

1. 先删历史 compat 主链，比“把 compat 搬去别处”更符合做薄原则
2. desktop runner 是真实桥接边界，独立存在是合理的；bus 不该内嵌 XPC/session 适配细节
3. browser runner 已经有自己的 bad args 机制，bus 不该再写第二份法官逻辑

## Alternatives

### 方案 A：只把 desktop 代码搬文件，不删 subcommand compat

- 优点：回归风险更低
- 缺点：历史债仍在，只是换位置，不算真正删层

### 方案 B：继续把更多 tool 实现全面 runners 化

- 优点：文件更短
- 缺点：容易变成“大搬家”，超出本轮最小可删版本

## Plan

1. 新增 `src/runners/desktop.ts`
   - 承接 `DesktopSessionPool`
   - 承接 desktopctl 查找与 RPC 执行
   - 返回结构化 `{ exitCode, stdout, stderr, artifacts }`
2. 修改 `src/tools/bus.ts`
   - 删除 desktop `subcommand` compat 分支
   - `desktop` case 改为调用 `runDesktopTool()`
   - 删除 `validateToolArgs()` 里的 browser per-operation 手写裁判
3. 更新测试
   - `test/tools.bus.test.ts`
   - `test/p5-7-r7a-browser-tool-bus.test.ts`
4. 更新 `docs/CHANGELOG.md`
5. 运行验证

## Risks

1. `desktop` 兼容主链删除会改变直接向 bus 传 `subcommand` 的行为
   - 回滚：恢复 desktop runner 抽离前的 compat 分支，但不恢复 bus 内嵌 session 代码
2. `browser` 参数错误的错误码可能从 `TOOL_BAD_ARGS` 变成执行层 `TOOL_EXEC_FAILED + BROWSER_BAD_ARGS`
   - 回滚：恢复单个字段校验，但不回退到完整 per-operation 裁判

## Test Plan

- `PATH="$HOME/.bun/bin:$PATH" bun test test/tools.bus.test.ts test/p5-7-r7a-browser-tool-bus.test.ts`
- `npx tsc --noEmit`
- `npm run docs:check`

（章节级）评审意见：[留空,用户将给出反馈]
