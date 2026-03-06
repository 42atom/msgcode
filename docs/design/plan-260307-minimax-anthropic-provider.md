# MiniMax Anthropic Provider 兼容方案

Issue: 0010
Task: docs/tasks/p5-7-r13-minimax-anthropic-provider.md

## Problem

当前 `minimax` provider 虽然已接入 `agent-backend`，但实际仍走 OpenAI-compatible `chat/completions` 路径。MiniMax 官方文档把 Anthropic-compatible 接口标为 Recommended，并要求 tool use / interleaved thinking 多轮中完整保留 assistant response。现有实现未满足该契约，导致我们与 Claude Code/Alma 的稳定路径脱节。

## Occam Check

1. 不加它，系统具体坏在哪？
   - `minimax` 下多轮 tool use 容易丢失 reasoning / tool-use 上下文，工具调用稳定性与官方推荐路径不一致。
2. 用更少的层能不能解决？
   - 能。新增一个 MiniMax 专用 provider 即可，不需要在主链中插 XML/content recover。
3. 这个改动让主链数量变多了还是变少了？
   - 主链数量不变，仍是“一个执行入口 + provider 内部适配”；只是把 `minimax` 从错误适配切到正确适配。

## Decision

采用“MiniMax 独立 provider，走 Anthropic-compatible 接口”的最小方案：

1. 仅对 `minimax` provider 新增 Anthropic-compatible adapter。
2. 复用现有 `runAgentChat` / `runAgentToolLoop` 主入口，不新增恢复层、判官层、双路回退。
3. 历史消息与工具回灌按 Anthropic content blocks 保真。

核心理由：

1. 与 MiniMax 官方推荐路径一致，最接近 Claude Code / Alma 的真实运行方式。
2. 不引入 fake recover，保持单一主链。
3. 改动边界集中在 provider 层，便于后续扩展其他供应商。

## Plan

1. 新增 MiniMax Anthropic adapter
   - 文件：
     - `src/providers/minimax-anthropic.ts`
   - 内容：
     - 请求构造
     - 响应解析
     - Anthropic content blocks <-> 内部消息结构映射
   - 验收：
     - 支持 `thinking` / `text` / `tool_use` / `tool_result`

2. 接线 chat/tool-loop
   - 文件：
     - `src/agent-backend/chat.ts`
     - `src/agent-backend/tool-loop.ts`
     - `src/agent-backend/config.ts`
   - 内容：
     - `minimax` 命中专用 adapter
     - 配置优先使用 Anthropic-compatible base URL
   - 验收：
     - `minimax` 不再打 `/v1/chat/completions`

3. 补测试
   - 文件：
     - `test/p5-7-r3g-multi-tool-loop.test.ts`
     - 视需要新增 `test/p5-7-r10-minimax-anthropic-provider.test.ts`
   - 验收：
     - no-tool
     - 单轮 tool use
     - 多轮 tool use
     - 最终 answer 收口

4. 文档与验证
   - 文件：
     - `issues/0010-minimax-anthropic-provider.md`
     - `docs/notes/research-260307-minimax-provider-compat.md`
     - `docs/CHANGELOG.md`
   - 验收：
     - `npx tsc --noEmit`
     - `npm test`
     - `npm run docs:check`

## Risks

1. 风险：Anthropic content block 映射不完整，导致 tool_result 回灌失败。
   - 回滚/降级：仅切回 `minimax` provider 适配，不影响 `openai/local-openai`。
2. 风险：现网环境仍使用旧的 `MINIMAX_BASE_URL=https://api.minimax.chat/v1`。
   - 回滚/降级：兼容读取旧配置并做确定性路径转换；如仍不可用，显式报错并要求设置 Anthropic base URL。
3. 风险：测试 mock 仍按 OpenAI 响应格式编写，覆盖不足。
   - 回滚/降级：新增 MiniMax 专用行为锁，不复用 OpenAI 响应假设。

## Alternatives

1. 保持 OpenAI-compatible 路径，仅补 `reasoning_split` 与历史保真。
   - 优点：改动较小。
   - 缺点：仍偏离官方 Recommended 路径，也不接近 Claude Code/Alma 的真实形态。
2. 在主链中增加 XML/content recover。
   - 否决原因：这是 fake recover 的回流，违反单一主链。

## Migration / Rollout

1. 先保留 `AGENT_BACKEND=minimax` 语义不变，仅替换其内部实现。
2. 优先兼容已有 `MINIMAX_BASE_URL`；若未显式配置，则默认切到 `https://api.minimax.io/anthropic`。
3. 真机回归顺序：
   - 直答
   - 单工具
   - 多轮工具
   - tool failure

## Test Plan

1. 单元 / 行为锁
   - MiniMax no-tool
   - MiniMax 单轮 tool_use
   - MiniMax 多轮 tool_use + tool_result 回灌
2. 回归
   - `npm test -- test/p5-7-r3g-multi-tool-loop.test.ts`
   - `npm test -- test/p5-7-r3h-tool-failure-diagnostics.test.ts`
3. 全量
   - `npx tsc --noEmit`
   - `npm test`
   - `npm run docs:check`

## Observability

1. 日志至少保留：
   - `provider=minimax`
   - `protocol=anthropic-compatible`
   - `decisionSource`
   - `toolCallCount`
2. 请求失败时区分：
   - 配置错误
   - 协议错误
   - provider HTTP 错误

（章节级）评审意见：[留空,用户将给出反馈]
