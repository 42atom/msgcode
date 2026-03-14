# Tool Loop 失败结果先回灌模型

## Problem

当前 `tool-loop` 在工具失败时会直接生成用户可见的结构化错误答案，导致模型拿不到失败结果去继续尝试。系统因此提前结案，违背“服务 LLM 完成任务”的主线。

## Occam Check

- 不加它，系统具体坏在哪？
  - 工具一旦失败，模型失去继续重试和改参机会，真实任务会被系统过早判死。
- 用更少的层能不能解决？
  - 能。不新增任何重试管理器，只把失败结果和成功结果一样回灌给模型。
- 这个改动让主链数量变多了还是变少了？
  - 变少了。删除“工具失败 -> 规则层直接结案”这条旁路，回到“模型看结果再决定”单一主链。

## Decision

选定方案：保留现有 `tool-loop` 骨架，但把“失败直接 forcedFinalState”改成“失败也形成 tool_result 回灌给模型”。用户最终看到的默认答复应来自模型，不再由系统直接转发底层工具错误。

关键理由：

1. 最小修改就能恢复模型续跑能力
2. 不新增控制层，只删除过早收束
3. 日志、actionJournal、verify 证据仍然完整保留

## Alternatives

### 方案 A：工具失败直接终态给用户

- 优点：诊断直观，实现已存在
- 缺点：抢执行权，模型无法继续完成任务

### 方案 B：失败先回灌模型，再由模型决定

- 优点：符合 agent-first 主线，恢复真实循环能力
- 缺点：会改动一批锁“直接回错误文案”的历史测试

推荐：方案 B

## Plan

1. 修改 [src/agent-backend/tool-loop.ts](/Users/admin/GitProjects/msgcode/src/agent-backend/tool-loop.ts)
   - 工具失败时继续写 actionJournal
   - 失败结果包装为可回灌的 `tool_result`
   - 当前轮次停止执行剩余同批工具，但不直接终态

2. 调整回归测试
   - [test/p5-7-r3h-tool-failure-diagnostics.test.ts](/Users/admin/GitProjects/msgcode/test/p5-7-r3h-tool-failure-diagnostics.test.ts)
   - [test/p5-7-r3g-multi-tool-loop.test.ts](/Users/admin/GitProjects/msgcode/test/p5-7-r3g-multi-tool-loop.test.ts)
   - [test/p5-7-r10-minimax-anthropic-provider.test.ts](/Users/admin/GitProjects/msgcode/test/p5-7-r10-minimax-anthropic-provider.test.ts)
   - [test/p5-7-r20-minimal-finish-supervisor.test.ts](/Users/admin/GitProjects/msgcode/test/p5-7-r20-minimal-finish-supervisor.test.ts)

3. 验证
   - `bun test` 定向用例
   - `npx tsc --noEmit`

4. 同一事故链上的薄收口
   - slash 命令识别从“任意 `/` 前缀”收口为“`/word` 命令形态”，绝对路径文本不再被命令层抢走
   - 已配置 owner 时，非 owner 的 slash 命令在 listener 入口静默忽略

## Risks

- 历史测试大量锁了“TOOL_EXEC_FAILED 直接返回给用户”的旧行为
- finish supervisor 仍在，会继续影响失败后的最终交付
- 若模型在拿到失败 `tool_result` 后仍不产出文本，可能暴露新的空答复路径

回滚策略：

- 若回归范围过大，可先回滚到旧失败直返语义
- 但不保留旧行为作为长期方案

## Test Plan

- 工具失败后，第二轮 fetch 必须出现，证明失败结果已回灌模型
- 用户最终答案不再强制包含 `TOOL_EXEC_FAILED`
- actionJournal 保留失败 errorCode / exitCode / stderrTail

## Observability

- 继续使用 `msgcode.log` 和 actionJournal 观察失败工具
- 若本轮出现空答复，单独记录新的日志证据，不额外加恢复层

## Result

- `tool-loop` 工具失败已从“直接终态给用户”改为“先回灌模型”
- `SOUL.md` 绝对路径误纠偏已收窄
- slash 命令形态识别已避免吞掉绝对路径文本
- 定向回归与 `tsc` 已通过

评审意见：[留空,用户将给出反馈]
