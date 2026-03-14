# Plan: 修复 finish supervisor 假失败

Issue: 0052

## Problem
当前 finish supervisor 在真实成功链上仍可能返回 `FINISH_SUPERVISOR_BLOCKED`。已知案例里，schedule 文件和 jobs 投影都已落盘成功，但最终因为 `监督员未明确放行` 被当成失败，造成“任务实际完成、用户看到失败”的假失败。

## Occam Check
- 不加它，系统具体坏在哪？
  - 工具链已完成的任务会被 supervisor 假阻塞，用户会误以为任务失败，后续还可能重复创建同类任务。
- 用更少的层能不能解决？
  - 能。优先收口 supervisor 的输出解析与阻断条件，不新增第二监督层或成功裁判层。
- 这个改动让主链数量变多了还是变少了？
  - 变少了。减少“任务主链成功，但被结束监督二次打回”的伪分叉。

## Decision
选定方案：对 finish supervisor 做最小收口，重点修三件事：
1. 明确记录 supervisor 原始输出，拿到 provider 真实返回证据；
2. 放宽对 PASS 的解析，兼容常见包装/前后缀；
3. 当本轮已经拿到明确成功证据时，避免因“未明确 PASS”而误阻塞。

核心理由：
- 当前问题更像“解析与收尾口径过窄”，不是 supervisor 思路本身完全错误。
- 直接删掉 supervisor 会回退到旧问题；继续加层会更重。
- 最小修法应该是把 supervisor 收口成“能放过明确成功，不吞掉真实失败”。

## Alternatives
1. 直接关闭 finish supervisor
   - 优点：立刻没有这类假失败。
   - 缺点：会丢掉真实未完成任务的二次复核能力。
2. 再加一层成功裁判 / tool 结果审计器
   - 优点：理论上更严。
   - 缺点：加层，违背当前做薄原则。

推荐：都不选，直接修现有 supervisor 的解析与阻断条件。

## Plan
1. 审计 `src/agent-backend/tool-loop.ts`
   - supervisor prompt
   - provider 调用返回
   - PASS/CONTINUE 解析
   - blocked completion 分支
2. 补日志
   - 至少记录 supervisor 原始输出或可脱敏摘要
3. 实施最小修复
   - 兼容 PASS 解析
   - 对“任务已完成”的场景避免误阻塞
4. 补测试
   - `test/p5-7-r20-minimal-finish-supervisor.test.ts`
   - `test/p5-7-r10-minimax-anthropic-provider.test.ts`
5. 运行针对性测试

## Risks
- 风险：过度放宽解析，真实未完成任务被误放行。
  - 缓解：只对明确成功证据场景放宽，不移除 CONTINUE 阻断能力。
- 风险：日志补充过多，污染主日志。
  - 缓解：只记录短摘要，避免长文本。

## Rollback
- 回滚 `src/agent-backend/tool-loop.ts` 与本轮测试改动。

## Test Plan
- `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r20-minimal-finish-supervisor.test.ts test/p5-7-r10-minimax-anthropic-provider.test.ts`

评审意见：[留空,用户将给出反馈]
