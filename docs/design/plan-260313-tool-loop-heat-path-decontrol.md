# plan-260313-tool-loop-heat-path-decontrol

## Problem

`tool-loop` 热路径已经移除了 finish supervisor、fallback answer、verify hot path 等层，但工具失败后的恢复分支仍在执行核里替模型做决定：当模型先复述原始错误或给出近似空答时，系统会注入 synthetic user nudge，再向同一模型追打一轮。这让主链仍然是“模型 -> 工具 -> 结果 -> 系统补救 -> 模型”，没有完全收口到最小执行链。

## Occam Check

### 不加它，系统具体坏在哪？

- 工具失败后仍有一层执行核代决逻辑替模型决定“再试一次”
- OpenAI / MiniMax 两条 loop 都继续维护这层 synthetic recovery prompt
- 热路径继续混入系统 hardcoded guidance，而不只是转运真实工具结果

### 用更少的层能不能解决？

- 能。直接删除 recovery nudge helper 与两处调用分支，保持真实 `tool_result` 回灌给模型
- quota 继续走现有结构化 helper，不新增替代层

### 这个改动让主链数量变多了还是变少了？

- 变少了。执行核少一层补救型主链，回到“模型 -> 工具 -> 结果 -> 模型”

## Decision

选定方案：删除 `tool-loop` 中工具失败后的恢复提示与系统代决分支，保留安全/预算/物理边界和 quota 结构化事实。

核心理由：

1. recovery nudge 不提供新能力，只在热路径替模型做主
2. 现有 `tool_result` 已包含错误码、退出码、stderr/stdout 片段，模型具备足够事实继续决策
3. quota helper 已经完成去中文模板化，本轮不需要再扩散到 `TaskSupervisor`

## Plan

1. 更新 `issues/0153-tool-loop-heat-path-decontrol.md`
   - 冻结范围、验收和证据
2. 修改 `src/agent-backend/tool-loop.ts`
   - 删除 recovery nudge 常量与 helper
   - 删除 OpenAI / MiniMax 两处 synthetic user 注入分支
   - 保持 quota helper 和 tool_result 回灌不变
3. 更新回归测试
   - `test/p5-7-r3h-tool-failure-diagnostics.test.ts`
   - `test/p5-7-r10-minimax-anthropic-provider.test.ts`
4. 运行验证
   - tool-loop multi-call / failure diagnostics / quota continuation 相关测试
   - `npx tsc --noEmit`
   - `npm run docs:check`
5. 更新 issue Notes / 状态与 `docs/CHANGELOG.md`

## Risks

1. 某些旧测试依赖系统补打一轮恢复，删除后需要同步改成“直接返回模型真实输出”
2. 若误删 quota / continuable 结构，TaskSupervisor 续跑链会回归；回滚策略：只回退 `src/agent-backend/tool-loop.ts` 与本轮测试，不恢复 recovery nudge 以外的旧层

## Test Plan

- OpenAI：工具失败后模型复述错误时，不再出现第三次内部请求
- MiniMax：同场景不再出现 synthetic user 恢复提示
- quota：`TOOL_LOOP_LIMIT_EXCEEDED` 仍保留 `quotaSignal` 和 `continuable`
- smoke：`TaskSupervisor` 的 quota continuation 路径保持通过

（章节级）评审意见：[留空,用户将给出反馈]
