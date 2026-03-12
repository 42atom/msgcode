# help 工具接入主探索路径与 quota 热路径瘦身

## Problem

当前 runtime 的骨架还差最后几处主链杂质：

1. `help-docs` 只存在于 CLI 侧，模型要自发现合同仍主要靠 schema 注入与技能文案
2. 工具索引仍写死“写改文件优先用 bash”，让工具面出现 suppress + prompt 映射折返
3. 配额命中时，tool-loop 直接在热路径生成中文系统说明，把预算边界和用户交付绑死在一起

这些点不会立刻让系统坏掉，但会持续拉低“模型自己探索、自己决定、系统只提供事实”的骨架纯度。

## Occam Check

- 不加它，系统具体坏在哪？
  - 模型仍要靠 prompt 猜 CLI 合同；quota 命中时热路径继续替系统写中文说明；工具索引继续把 bash 当成隐式总入口。
- 用更少的层能不能解决？
  - 能。不是再加 help manager 或 quota controller，而是把现有 `help-docs` 直接做成工具，并把 quota 结果收口成结构化事实。
- 这个改动让主链数量变多了还是变少了？
  - 变少了。模型探索 CLI 合同不再绕 CLI 壳，quota 热路径不再直接生成人话模板。

## Decision

选定方案：新增一个轻量只读工具 `help_docs` 进入模型默认工具面；同时把 quota 命中改成结构化返回，让热路径只产事实，不再直接写用户说明。

关键理由：

1. `help-docs` 本身已经是现成真相源，接成工具不需要新控制层
2. 先让模型能主动查命令合同，比继续堆 prompt hint 更符合参考骨架
3. quota 命中最适合先退成“机器标记 + 结构化字段”，后续若需要用户呈现，再由外层单独决定

## Plan

1. 接入 `help_docs`
   - `src/cli/help.ts`：抽出共享数据构造函数
   - `src/tools/types.ts`：新增 `ToolName` / `ToolDataMap`
   - `src/tools/manifest.ts`：新增工具说明书
   - `src/tools/bus.ts`：新增只读执行分支
2. 进入默认主探索路径
   - `src/config/workspace.ts`：默认 `tooling.allow` 加入 `help_docs`
   - `src/routes/cmd-tooling.ts`：同步用户可见工具列表
   - `src/agent-backend/tool-loop.ts`：工具索引改为“不会就先查 help_docs”
3. 收口 quota 热路径
   - `src/agent-backend/types.ts`：新增结构化 quota 字段
   - `src/agent-backend/tool-loop.ts`：统一 quota 返回 helper，answer 改成机器标记
   - `src/runtime/task-supervisor.ts`：checkpoint summary 对 quota continuable 保留任务语义，不吃机器标记
4. 补回归
   - `test/tools.bus.test.ts`
   - `test/p5-6-8-r4g-pi-core-tools.test.ts`
   - `test/p5-7-r6-hotfix-gen-entry-tools-default.test.ts`
   - `test/p5-7-r3g-multi-tool-loop.test.ts`
   - `test/p5-7-r3h-tool-failure-diagnostics.test.ts`

## Risks

1. `help_docs` 进入默认工具面后，模型可能过度依赖它；回滚/降级：从默认 allow 移除，但保留工具实现
2. quota answer 改成机器标记后，某些外层展示可能显得更“硬”；回滚/降级：保留结构化字段，同时恢复短文案
3. 默认工具面变更会波及若干基线测试；回滚/降级：同步回退 `workspace/tooling` 默认项与相关测试

## Test Plan

- `bun test test/tools.bus.test.ts test/p5-6-8-r4g-pi-core-tools.test.ts test/p5-7-r6-hotfix-gen-entry-tools-default.test.ts test/p5-7-r3g-multi-tool-loop.test.ts test/p5-7-r3h-tool-failure-diagnostics.test.ts`
- `npx tsc --noEmit`
- `npm run docs:check`

## Observability

- `help_docs` 调用仍会走 Tool Bus 统一 telemetry
- quota 命中后会保留 `continuationReason` 与新增结构化 quota 字段；热路径 answer 不再承载说明文案

（章节级）评审意见：[留空,用户将给出反馈]
