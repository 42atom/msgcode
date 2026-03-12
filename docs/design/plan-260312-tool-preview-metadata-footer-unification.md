# Tool Preview 元数据脚注统一收口

## Problem

当前 Tool Bus 已经成为 `previewText` 的单一真相源，但执行层结果合同仍有轻微漂移：有的 preview 带 `exitCode/fullOutputPath`，有的只有正文，有的没有稳定 `durationMs`。这会让模型在多轮执行中拿到的证据格式不稳定，也削弱了 “CLI 输出本身就是导航系统” 这条主线。

## Occam Check

- 不加这次收口，系统具体坏在哪？
  - 结果合同会继续依赖各工具各自的临时习惯，模型在不同工具之间切换时需要重新适应反馈格式，恢复与排障成本更高。
- 用更少的层能不能解决？
  - 能。只在 Tool Bus 内部加一个纯 helper，统一尾部脚注；不新增工具、不新增 manager、不回流到 `tool-loop`。
- 这个改动让主链数量变多了还是变少了？
  - 变少了。把散在各工具的元数据表达收口到执行层一个 helper，避免后面再在上游补第二套格式化。

## Decision

选定方案：在 Tool Bus 内部增加一个**纯 preview footer helper**，统一追加元数据脚注。

核心理由：

1. 这是一刀“收口”，不是“加层”
2. 只影响执行层结果合同，不影响模型决策主链
3. 能直接增强模型看到的证据稳定性，符合 Unix 输出即接口的思路

## Alternatives

### 方案 A：维持现状

- 优点：零改动
- 缺点：元数据继续漂移，后续更容易在 `tool-loop` 或提示词层补丁化

### 方案 B：新建仓库级 `text-preview` 层

- 优点：形式上看起来统一
- 缺点：容易把 preview 重新拉回主链上游，变成新层

### 方案 C：只在 Tool Bus 内部加 footer helper

- 优点：最薄、最直接、最符合当前架构方向
- 缺点：只能解决元数据统一，不能替代工具主文本设计

推荐：方案 C

## Plan

1. 在 `src/tools/bus.ts` 增加纯函数 helper
   - 统一追加 `durationMs`
   - 若 `fullOutputPath` 存在且正文未包含，再追加 `fullOutputPath`
   - 保证总长度仍在执行层裁剪
2. 在 `executeTool()` 返回前统一走该 helper
3. 补 `test/tools.bus.test.ts`
4. 更新 `docs/CHANGELOG.md`

## Risks

- 若 footer 处理不当，可能把正文截坏或重复输出 `fullOutputPath`
- 若 helper 侵入 builder 级正文逻辑，会重新长出 preview 第二层

回滚/降级策略：

- 回退 `src/tools/bus.ts`、`test/tools.bus.test.ts`、`docs/CHANGELOG.md`

## Test Plan

- `bun test test/tools.bus.test.ts test/p5-7-r25-tool-result-context-clip.test.ts test/p5-7-r3h-tool-failure-diagnostics.test.ts`
- `npx tsc --noEmit`
- `npm run docs:check`

评审意见：[留空,用户将给出反馈]
