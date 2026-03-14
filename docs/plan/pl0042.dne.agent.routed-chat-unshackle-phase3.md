# Plan: Routed Chat 松绑 Phase 3

## Problem

`0041` 已经清掉 `prompt.ts` 和 `tool-loop.ts` 里的主要控制逻辑，但 `src/agent-backend/routed-chat.ts` 仍残留一层入口裁判：降级时强制 no-tool、显式 `forceComplexTool` 时强制 plan/act/report、默认链路又被改成 `allowNoTool: false`。这让入口层还在替 LLM 预判“这轮应不应该用工具”，与当前“默认给工具、只按配置过滤、不按流程裁判”的主链目标冲突。

## Occam Check

1. 不加这次改动，系统具体坏在哪？
   入口层残影仍可能在消息入口提前判成 no-tool 或特殊分支，重新制造 no-tool / degrade 类随机阻断。
2. 用更少的层能不能解决？
   可以。直接删除 routed-chat 里的残余裁判，不新增替代层。
3. 这个改动让主链数量变多了还是变少了？
   变少。目标是让路由层更薄，只剩“组织上下文 -> 调起 tool-loop -> 返回真实结果”一条主链。

## Decision

采用“删入口裁判，不换入口裁判”的 Phase 3：

1. `routed-chat.ts` 默认统一进入 `runAgentToolLoop()`。
2. 保留显式配置边界，例如 workspace 工具暴露与模型选择；不再在路由层强制 no-tool 或 complex-tool。
3. `LEVEL_2` 只影响模型选择，不再由路由层直接降为纯文本。
4. `allowNoTool` 由 tool-loop 处理，路由层不再用 `allowNoTool: false` 替模型判死。
5. 清掉 `hasToolsAvailable`、`forceComplexTool` 及相关注释/契约残影，测试锁定新口径。

## Alternatives

### 方案 A：保留 degrade / complex-tool 分支，但仅改文案

不选。行为仍在，只是把旧裁判换了话术。

### 方案 B：新增更精细的入口分类器

不选。会再长出一层“更聪明的入口”，与本轮 Occam 目标相反。

## Plan

1. 盘点 `src/agent-backend/routed-chat.ts`
   - 列出仍生效的 `degrade` / `forceComplexTool` / `allowNoTool: false`
   - 列出已死代码：`toolsAvailable`
   - 列出文案残影：文件头注释、logger 中的 router/degrade 决策语义
2. 修改 `src/agent-backend/routed-chat.ts`
   - 删除 `LEVEL_2 -> runLmStudioChat()` 分支
   - 删除 `forceComplexTool` 的 plan/act/report 分支
   - 默认统一走 `runAgentToolLoop()`
   - 改为传 `allowNoTool: true`
   - 使用 `selectedModel`，让降级只影响模型选择，不影响入口路由
3. 收口类型和兼容层
   - `src/agent-backend/types.ts` 去掉不再作为主链契约的入口残影字段
   - `src/lmstudio.ts` 对齐兼容接口
4. 补测试
   - routed-chat 默认进入 tool-loop
   - 不再存在 routed-chat 里的 degrade/no-tool/complex-tool 前置裁判残影
   - MiniMax 无工具场景由模型结果决定，不再记为 router 决策
   - 保留 schedule create/remove 主链回归
5. 真机验证
   - `定一个每分钟发送的任务 发：live cron`
   - `现在可以停止发送 cron live了`
   - 验证都进入真实工具链，创建/停止结果真实生效

## Risks

1. 某些旧测试仍锁着 `router` / `complex-tool` 旧口径。
   - 处理：更新测试到新合同，不回退入口裁判。
2. `LEVEL_2` 不再强制纯文本后，工具主链会继续尝试执行。
   - 处理：仍由显式工具暴露与模型选择边界控制，不新增路由层 fallback。
3. 兼容类型删除字段可能影响少量旧调用方。
   - 处理：先全仓搜引用；若仅剩残影则直接删，若还有外部使用则改成明确 deprecated 注释并断开行为。

## Test Plan

1. routed-chat 源码契约：
   - 不再包含 `forceComplexTool`
   - 不再包含 `degrade mode: forcing no-tool`
   - 默认路径传 `allowNoTool: true`
2. 行为回归：
   - MiniMax 无工具场景返回 `decisionSource: "model"`
   - 默认 routed-chat 仍能进入 tool-loop 并返回真实结果
3. 主链回归：
   - `test/p5-7-r18-schedule-refresh-on-mutation.test.ts`
   - 相关 agent/tool-loop 路径测试

## Observability

重点关注：

1. `agent-first tool-loop started`
2. `agent-first chat completed`
3. 是否还出现 `decisionSource: "router"` 或 `decisionSource: "degrade"` 的 routed-chat 入口日志
4. schedule create/remove 后是否仍有真实 `Tool Bus` 成功记录

评审意见：[留空,用户将给出反馈]
