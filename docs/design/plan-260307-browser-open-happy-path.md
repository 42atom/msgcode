# Plan: browser 打开网页 happy path 收口

Issue: 0020

## Problem

当前 `browser` 工具把 PinchTab 原始协议几乎原样暴露给模型。结果是最基本的“打开网页”也要求模型先知道 `instances.launch -> tabs.open(instanceId)` 的两步协议，真实日志已经证明这会导致 `tabs.open` 因缺少 `instanceId` 而失败。

## Occam Check

- 不加它，系统具体坏在哪？
  用户一句“打开 github.com 首页”，模型即使已经正确选了 `browser`，也会因为没先构造 `instanceId` 直接失败。
- 用更少的层能不能解决？
  能。直接在现有 `tabs.open` 桥接里自动补一次 `instances.launch`，不新增中间层。
- 这个改动让主链数量变多了还是变少了？
  变少了。把“模型必须记住两步协议”收口为“打开网页一次调用即可成功”的单一路径。

## Decision

采用最小 happy path 收口：

1. `tabs.open` 若显式给了 `instanceId`，保持现状。
2. `tabs.open` 若未给 `instanceId`，桥接层自动 `instances.launch` 一个默认实例。
3. 若传入的 `profileId` 在 PinchTab 中不存在，自动忽略该 `profileId` 并退回默认 launch。
4. `tabs.open` 结果补回 `instanceId`，让后续 `tabs.snapshot/text/action` 可继续沿用。
5. 提示层只补一条最小合同说明，不再要求模型手动拼完整实例启动协议。

## Plan

1. 收口 browser runner
- 修改：
  - `/Users/admin/GitProjects/msgcode/src/runners/browser-pinchtab.ts`
- 验收点：
  - `tabs.open` 缺 `instanceId` 时自动 launch 后成功 open

2. 更新工具说明与提示
- 修改：
  - `/Users/admin/GitProjects/msgcode/src/tools/manifest.ts`
  - `/Users/admin/GitProjects/msgcode/prompts/agents-prompt.md`
- 验收点：
  - 明确“打开网页可直接 `tabs.open + url`”

3. 回归测试
- 修改：
  - `/Users/admin/GitProjects/msgcode/test/p5-7-r7a-browser-runner.test.ts`
- 验收点：
  - 新增 happy path 测试通过

## Risks

1. 自动补实例可能增加后台实例数量。
回滚/降级：保留返回 `instanceId`，必要时仅对未给 `instanceId` 的 `tabs.open` 回退到旧逻辑。

2. 模型可能继续使用旧两步协议。
回滚/降级：无须回滚，显式 `instanceId` 路径继续兼容。

## Rollback

- 回退 `browser-pinchtab.ts`、`manifest.ts`、`agents-prompt.md` 与对应测试本轮改动。

## Test Plan

- `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r7a-browser-runner.test.ts`

## Observability

- 继续观察：
  - `Tool Bus: FAILURE browser`
  - `错误：browser: 'tabs.open' requires 'instanceId'`
  - `错误：BROWSER_HTTP_ERROR: profile "work-default" not found`
  - `toolSequence=ok:browser`

（章节级）评审意见：[留空，用户将给出反馈]
