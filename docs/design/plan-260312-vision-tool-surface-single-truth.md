# vision 工具面收口为 tooling.allow 单一真相源

## Problem

`vision` 当前同时存在于默认 `tooling.allow` 和隐藏 suppress 机制里：

- 配置层说“默认允许”
- 运行时又说“默认不暴露”

这让 `tooling.allow` 失去真相源资格，也让 LLM 工具面变成“配置一套、暴露一套、执行再判一套”的折返结构。

## Occam Check

- 不加这次收口，系统具体坏在哪？
  - `tooling.allow` 会继续是假真相源；用户和模型看到的工具面与运行时实际暴露仍然漂移，排障成本高。
- 用更少的层能不能解决？
  - 能。直接把默认配置改正，并删除 `vision` 的隐藏 suppress，不新增任何新层。
- 这个改动让主链数量变多了还是变少了？
  - 变少了。删掉一层运行时暗中过滤，让配置层重新成为单一入口。

## Decision

选定方案：`vision` 不再通过隐藏 suppress 控制；默认是否暴露只由默认 `tooling.allow` 决定。

核心理由：

1. `vision` 已有执行实现，不该继续靠暗中过滤假装不存在
2. 默认不暴露应该写在默认配置里，而不是写成运行时偷改
3. 显式 opt-in 的 workspace 应该得到真实一致的工具面

## Alternatives

### 方案 A：维持现状

- 优点：零改动
- 缺点：`tooling.allow` 继续是假真相源

### 方案 B：把 `vision` 整体移出工具面

- 优点：更绝对
- 缺点：会误伤已经存在的执行实现和显式 opt-in 用法

### 方案 C：去掉隐藏 suppress，默认配置显式移除

- 优点：最薄、最直、与当前工程状态最一致
- 缺点：需要调整一批旧测试口径

推荐：方案 C

## Plan

1. 改 `src/config/workspace.ts`
   - 默认 `tooling.allow` 移除 `vision`
2. 改 `src/tools/manifest.ts`
   - 不再 suppress `vision`
3. 改 `src/agent-backend/tool-loop.ts` / `src/tools/bus.ts`
   - 不再对 `vision` 走隐藏过滤
4. 改测试
   - 默认无 `vision`
   - 显式 allow 时应真实暴露/可执行
5. 更新 `docs/CHANGELOG.md`

## Risks

- 旧测试会大量失败，需要统一改口径
- 若有依赖“默认 policy.allow 包含 vision” 的隐性逻辑，需要及时修正

回滚/降级策略：

- 回退 `src/config/workspace.ts`、`src/tools/manifest.ts`、`src/agent-backend/tool-loop.ts`、`src/tools/bus.ts`、相关测试与 `docs/CHANGELOG.md`

## Test Plan

- `bun test test/p5-7-r8c-llm-tool-manifest-single-source.test.ts test/tools.bus.test.ts test/p5-7-r6-hotfix-gen-entry-tools-default.test.ts test/p5-6-8-r3b-edit-file-patch.test.ts`
- `npx tsc --noEmit`
- `npm run docs:check`

评审意见：[留空,用户将给出反馈]
