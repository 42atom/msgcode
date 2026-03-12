# Tool Loop 失败恢复提示最小收口

## Problem

当前 `tool-loop` 已经做到“失败结果先回灌模型”，但还没做到“失败后继续推动模型恢复”。真实 live log 证明：工具失败后，如果模型这一轮没有继续发 `tool_call`，系统就把原始错误或近似错误交回给用户，loop 只跑成了“给一次机会”的半成品。

## Occam Check

- 不加它，系统具体坏在哪？
  - 网页、文件、CLI 这类真实任务会在第一次 bash 错误后停住，用户只能靠追问“你不再试了吗”才能触发下一轮。
- 用更少的层能不能解决？
  - 能。不新增恢复管理器，只在“失败后仍输出空答复/原始错误诊断”这个明确未完成态下，给同一模型一个最小恢复提示。
- 这个改动让主链数量变多了还是变少了？
  - 变少了。它删除“失败后直接交回用户”的半截出口，回到“模型读失败结果继续尝试”的单主链。

## Decision

选定方案：保留现有 `tool_result` 回灌机制，并在失败后只针对“明显未完成态”追加一个最小恢复提示，推动同一模型继续尝试。

关键理由：

1. 先修主链，不再让用户用追问人工补 loop
2. 不恢复以前那种通用 auto-retry，只收口失败恢复这一条
3. OpenAI 与 MiniMax 两条 loop 保持同语义，避免双真相源

## Alternatives

### 方案 A：只改提示词，不改 loop

- 优点：最薄
- 缺点：对现有真实失败场景不够稳，模型仍可能直接把原始错误甩给用户

### 方案 B：失败后只要看起来未完成，就补一个最小恢复提示

- 优点：最贴近真实问题，修改小，能直接修 live 场景
- 缺点：属于窄恢复逻辑，需要用测试锁住边界

推荐：方案 B

## Plan

1. 修改 [tool-loop.ts](/Users/admin/GitProjects/msgcode/src/agent-backend/tool-loop.ts)
   - 新增“失败恢复提示”判定：失败后若模型只回空答复或原始错误诊断，则继续请求同一模型
   - OpenAI / MiniMax 两条 loop 同步接线
   - 限制恢复提示次数，避免无界空转

2. 修改提示词
   - [agents-prompt.md](/Users/admin/GitProjects/msgcode/prompts/agents-prompt.md)
   - [exec-tool-protocol-constraint.md](/Users/admin/GitProjects/msgcode/prompts/fragments/exec-tool-protocol-constraint.md)
   - 明确“工具失败时先读真实错误并继续尝试，不要把原始工具错误直接交给用户”

3. 修改测试
   - [p5-7-r3h-tool-failure-diagnostics.test.ts](/Users/admin/GitProjects/msgcode/test/p5-7-r3h-tool-failure-diagnostics.test.ts)
   - [p5-7-r10-minimax-anthropic-provider.test.ts](/Users/admin/GitProjects/msgcode/test/p5-7-r10-minimax-anthropic-provider.test.ts)
   - 必须锁“失败诊断会触发继续尝试并产生新 tool_call”

4. 验证
   - `bun test` 定向回归
   - `npx tsc --noEmit`
   - `npm run docs:check`
   - 真实 Feishu smoke：在 `smoke/ws-a` 群里用自然语言请求缺失文件恢复，必须看到同一轮 `fail -> recover -> complete`

## Risks

- 若恢复提示过宽，可能把本该结束的失败场景拖成长回路
- 若恢复提示过窄，live 群里仍会看到原始 bash 错误

回滚策略：

- 若误伤范围过大，先回滚恢复提示逻辑，仅保留提示词增强

## Test Plan

- OpenAI loop：第一次工具失败后，模型先回错误诊断，再被 nudged 发出新 tool_call，最终成功
- MiniMax loop：同口径验证
- 原有“通用 final answer auto-retry 已删除”测试不能被重新打回
- 真实 Feishu smoke：`recover-live-force-1773299959`，日志必须出现 `Tool Bus: FAILURE read_file -> SUCCESS bash -> SUCCESS read_file`，群里必须出现成功回执，workspace 必须落盘目标文件

## Observability

- 保留 `actionJournal` / `run-events` / `msgcode.log`
- 新增最小日志：记录恢复提示是否触发及触发次数

## Result

- OpenAI / MiniMax 两条 loop 已补上失败恢复提示
- 提示词已明确“失败先读 tool_result 再继续尝试”
- 定向验证已通过：
  - `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r3h-tool-failure-diagnostics.test.ts test/p5-7-r10-minimax-anthropic-provider.test.ts test/p5-7-r3g-multi-tool-loop.test.ts`
  - `npx tsc --noEmit`
  - `npm run docs:check`
- 真实 Feishu smoke 已通过：
  - case：`recover-live-force-1773299959`
  - 证据：`Tool Bus: FAILURE read_file -> SUCCESS bash -> SUCCESS read_file`
  - 群回执：`已处理。文件原本不存在，我已成功创建 recover-live-force-1773299959.txt...`
  - 落盘：`/Users/admin/msgcode-workspaces/smoke/ws-a/recover-live-force-1773299959.txt`

评审意见：[留空,用户将给出反馈]
