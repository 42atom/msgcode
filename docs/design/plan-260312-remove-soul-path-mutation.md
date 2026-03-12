# 移除 tool-loop 对 SOUL 路径的静默改参

## Problem

当前 `tool-loop` 会在 `read_file` 上对一类 `SOUL.md` 路径做静默改写：把 `SOUL.md`、`./SOUL.md`、`<workspace>/SOUL.md` 直接变成 `.msgcode/SOUL.md`。这让系统继续偷偷纠偏模型参数，破坏了“LLM -> 发参数 -> 工具原生执行 -> 原始结果回给模型”的单一主链。

## Occam Check

- 不加它，系统具体坏在哪？
  - 系统继续篡改模型参数，用户和模型都看不到真实失败路径，后续排障和能力演进都会被误导。
- 用更少的层能不能解决？
  - 能。直接删除 `normalizeSoulPathArgs()`，让 `read_file` 按原始参数执行并把真实错误回灌。
- 这个改动让主链数量变多了还是变少了？
  - 变少了。删掉“模型参数 -> 系统改参 -> 工具执行”的旁路，只剩“模型参数 -> 工具执行”。

## Decision

选定方案：删除 `normalizeSoulPathArgs()` 及其调用，不再对 `SOUL.md` 做任何静默纠偏。若模型路径写错，直接由 `read_file` 返回真实错误；是否重试、如何修正路径，交回模型自己决定。

## Alternatives

### 方案 A：保留现状

- 优点：少量 case 更容易“看起来成功”
- 缺点：系统继续暗改参数

### 方案 B：删除静默纠偏

- 优点：最符合当前主线，真实错误完整回给模型
- 缺点：个别模型可能需要多一轮才学会 `.msgcode/SOUL.md`

推荐：方案 B

## Plan

1. 更新 [src/agent-backend/tool-loop.ts](/Users/admin/GitProjects/msgcode/src/agent-backend/tool-loop.ts)
   - 删除 `normalizeSoulPathArgs()`
   - 删除 Anthropic/OpenAI 两处调用

2. 更新 [test/p5-7-r3l-7-tool-protocol-retry-and-soul-normalize.test.ts](/Users/admin/GitProjects/msgcode/test/p5-7-r3l-7-tool-protocol-retry-and-soul-normalize.test.ts)
   - 旧口径：SOUL 路径应自动纠偏
   - 新口径：错误路径应保留原生失败，并由模型接收失败结果后继续答复

3. 更新 [docs/CHANGELOG.md](/Users/admin/GitProjects/msgcode/docs/CHANGELOG.md)

4. 验证
   - `bun test` 定向回归
   - `npx tsc --noEmit`
   - `npm run docs:check`

## Risks

- 部分 prompt 可能因为不再自动纠偏而显露真实路径错误
- 这类问题应由 skill 文案与 live prompt corpus 收口，而不是在主链里继续暗改参数

回滚策略：

- 直接回滚 `tool-loop.ts`、`p5-7-r3l-7` 回归锁、issue/plan 与 changelog

评审意见：[留空,用户将给出反馈]
