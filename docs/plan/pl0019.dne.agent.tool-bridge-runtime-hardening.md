# Plan: 工具桥接运行时收口

Issue: 0019

## Problem

当前系统已经在默认暴露层把文件主链收口到 `read_file + bash`，但执行层仍可能跑到旧工具。这说明工具桥接链路仍有断层：模型看到的 `tools[]`、`llm-tool-call` 实际 allowlist、运行时执行入口三者没有完全对齐。另外，日志只记单个 `toolName`，无法看清多步工具轮次。

## Occam Check

- 不加它，系统具体坏在哪？
  模型就算没拿到 `edit_file`，只要自己编一个 `edit_file` tool_call，运行时仍可能执行成功或失败，继续污染真实主链。
- 用更少的层能不能解决？
  能。直接在现有执行入口校验“是否属于本轮暴露工具”，并让 `llm-tool-call` 的 allowlist 与暴露层复用同一过滤逻辑，不新增控制面。
- 这个改动让主链数量变多了还是变少了？
  变少了。暴露层、执行层、日志层围绕同一份工具真相源收口，不再出现一层说能、一层说不能的分叉。

## Decision

采用最小运行时收口方案：

1. `llm-tool-call` 在 Tool Bus 侧使用与默认暴露层相同的过滤逻辑。
2. Tool Loop 在真正执行前校验工具名是否属于 `activeToolNames`。
3. handler 与 routed-chat 记录整轮工具序列。
4. 浏览器底座切换不并入本轮，继续走既有 Patchright 计划。

## Plan

1. 收口 `llm-tool-call` allowlist
- 修改：
  - `/Users/admin/GitProjects/msgcode/src/tools/manifest.ts`
  - `/Users/admin/GitProjects/msgcode/src/tools/bus.ts`
- 验收点：
  - `llm-tool-call` 无法执行默认已收口掉的旧工具

2. 封死未暴露工具执行
- 修改：
  - `/Users/admin/GitProjects/msgcode/src/agent-backend/tool-loop.ts`
- 验收点：
  - OpenAI-compatible 与 MiniMax Anthropic 两条 tool loop 都会拒绝未暴露工具

3. 补整轮工具序列日志
- 修改：
  - `/Users/admin/GitProjects/msgcode/src/agent-backend/routed-chat.ts`
  - `/Users/admin/GitProjects/msgcode/src/handlers.ts`
- 验收点：
  - 日志包含工具序列字符串

4. 回归测试
- 修改：
  - `/Users/admin/GitProjects/msgcode/test/tools.bus.test.ts`
  - `/Users/admin/GitProjects/msgcode/test/p5-7-r3l-7-tool-protocol-retry-and-soul-normalize.test.ts`
  - `/Users/admin/GitProjects/msgcode/docs/CHANGELOG.md`
- 验收点：
  - 定向测试通过

## Risks

1. 如果执行层拒绝未暴露工具过严，可能暴露出旧测试或旧 workspace 假设。
回滚/降级：保留底层工具实现，仅回退“拒绝执行未暴露工具”逻辑。

2. 日志字段增加可能引入轻微噪音。
回滚/降级：保留序列日志，必要时缩短字段长度，不回退真相源收口。

## Rollback

- 回退 `tool-loop.ts`、`tools/bus.ts`、`handlers.ts`、`routed-chat.ts` 本轮改动。

## Test Plan

- `PATH="$HOME/.bun/bin:$PATH" bun test test/tools.bus.test.ts`
- `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r3l-7-tool-protocol-retry-and-soul-normalize.test.ts`

## Observability

- 继续观察：
  - `Tool Bus: FAILURE edit_file`
  - `Tool Bus: SUCCESS edit_file`
  - 新增的 `toolSequence=...`

（章节级）评审意见：[留空，用户将给出反馈]
