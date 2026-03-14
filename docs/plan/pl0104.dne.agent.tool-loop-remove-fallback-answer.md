# 去掉 tool-loop 的系统代答

## Problem

`tool-loop` 已经把工具失败先回灌给模型，但在“模型首轮结束时没给出合法最终答复”这个分支上，系统仍会通过 `buildToolLoopFallbackAnswer()` 自己编出用户可见答案。这条旁路继续违背 AI 主执行权：系统不是在提供结果，而是在替模型交付。

## Occam Check

- 不加它，系统具体坏在哪？
  - 即使工具结果已经忠实回给模型，最终用户看到的仍可能是系统规则模板，如“读取成功，内容预览如下”“命令执行完成”，导致主链继续被系统代答污染。
- 用更少的层能不能解决？
  - 能。不新增任何新层，只删除 fallback 代答，改为向同一个模型补要一次禁止工具的最终答复。
- 这个改动让主链数量变多了还是变少了？
  - 变少了。删除“系统模板直出”这条旁路，回到“模型基于已有结果交付最终答复”单一主链。

## Decision

选定方案：删除 `buildToolLoopFallbackAnswer()` 调用；若模型在工具轮后返回空文本或协议残片，则再向模型发起一次 **禁止工具的最终答复请求**。这次补答仍由模型完成，不由系统代答。

关键理由：

1. 比直接砍 `finish supervisor` 更小、更稳，且直接命中“系统代答”问题
2. 不新增控制面，只延长同一主链一次
3. 能显著减少“工具跑了，但最后一句是系统写的”这种结构污染

## Alternatives

### 方案 A：保留 fallback answer

- 优点：实现简单
- 缺点：继续抢执行权，系统代答依旧存在

### 方案 B：删除 fallback，并向模型补要最终答复

- 优点：最终答复重新回到模型
- 缺点：会新增一次模型请求，需要调整测试

### 方案 C：删除 fallback，若无答复就直接返回空字符串

- 优点：最少代码
- 缺点：用户交付面退化过大，且缺少可用结果

推荐：方案 B

## Plan

1. 更新 [src/agent-backend/tool-loop.ts](/Users/admin/GitProjects/msgcode/src/agent-backend/tool-loop.ts)
   - 新增最小 helper：检测“最终答复缺失/仍含协议残片”
   - 在 OpenAI 与 MiniMax 两条路径中删除 `buildToolLoopFallbackAnswer()` 调用
   - 追加一轮 `toolChoice: none` / `tools: []` 的最终答复补要请求

2. 调整测试
   - [test/p5-7-r3h-tool-failure-diagnostics.test.ts](/Users/admin/GitProjects/msgcode/test/p5-7-r3h-tool-failure-diagnostics.test.ts)
   - 必须锁住：
     - callCount 增加到 3
     - 最终答案来自模型补答
     - 结果里不再出现 `读取成功，内容预览如下` / `命令执行完成`

3. 验证
   - `bun test` 定向用例
   - `npx tsc --noEmit`

## Risks

- 某些历史测试默认假设“工具轮后第二次请求就是最终答复”
- 若模型补答仍为空，可能暴露新的空答复边界
- MiniMax 与 OpenAI 路径都要同步，否则行为会漂

回滚策略：

- 若补答路径引起大范围回归，可先回滚到旧行为
- 但不保留系统代答作为长期方案

## Test Plan

- 工具轮后若模型返回空文本，系统应再向模型请求一次最终答复
- 用户最终答案应来自第三次请求
- 系统不再构造“读取成功/命令执行完成/工具执行成功”模板

评审意见：[留空,用户将给出反馈]
