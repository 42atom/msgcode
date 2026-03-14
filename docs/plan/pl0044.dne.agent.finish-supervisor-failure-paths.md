# Plan: finish supervisor 失败收尾路径收口

Issue: 0044

## Problem

当前 finish supervisor 只接在“正常完成出口”。一旦工具执行失败，tool-loop 会直接返回失败文本给用户，绕过统一结束口。日志已经证明正常收尾有 `finish supervisor reviewed`，但失败收尾没有。

## Occam Check

### 1. 不加这次改动，系统具体坏在哪？

系统会同时存在两条结束路径：成功路径经过 supervisor，失败路径绕过 supervisor。这样结束口不统一，监督机制只覆盖“看起来成功”的情况，失败场景会形成旁路。

### 2. 用更少的层能不能解决？

能。只把现有工具失败早退口并入已有 finish supervisor，不新增新的监督层、恢复层或失败自动修复层。

### 3. 这个改动让主链数量变多了还是变少了？

会变少。目标是把失败旁路收回到同一个结束口，让所有终态都走一条 finish supervisor 主链。

## Decision

采用“保留真实失败文本 + 失败也走现有 finish supervisor”的最小方案。

核心理由：

1. 旁路点已经明确在 `toolResult.error` 的直接 `return`
2. 只补齐覆盖范围，不改变 `PASS / CONTINUE / 3 次阻塞` 协议
3. 失败事实仍由 tool-loop 生成，supervisor 只判断能否结束，不负责美化或修复失败

## Plan

1. 在 `/Users/admin/GitProjects/msgcode/src/agent-backend/tool-loop.ts` 标记工具失败终态：
   - 保留失败 answer / errorCode / exitCode / stderrTail
   - 不再直接 `return`
   - 进入现有 finish supervisor 收尾
2. 对 OpenAI 与 MiniMax 两套 tool-loop 同步补齐：
   - 同样的失败出口
   - 同样的 finish supervisor 收尾语义
3. 在同一文件保留最小失败上下文：
   - 失败 answer
   - 失败 toolCall
   - 失败 verifyResult
4. 若 supervisor 返回 `CONTINUE`：
   - 仍按现有语义继续主循环
   - 连续 3 次 `CONTINUE` 后返回阻塞结果
5. 补测试：
   - OpenAI 路径下 `fail` / `ok -> fail` 都会新增 `finish-supervisor` journal
   - MiniMax 路径下工具失败也会走 finish supervisor
   - 正常成功路径不回归
6. 真机 smoke：
   - 用自然语言 schedule add 失败场景复现
   - 日志中确认失败后也出现 `finish supervisor reviewed`

## Risks

1. 若失败上下文未正确传入 supervisor，可能让 `CONTINUE` 后丢失失败事实
   - 回滚/降级：保留失败 answer 作为主事实，并在继续前把失败文本回灌到会话
2. 若错误地把失败当成 verify 成功，可能污染 supervisor 判断
   - 回滚/降级：失败路径固定使用 `VerifyResult.ok = false`
3. 两套 provider 实现不一致会导致只修一半
   - 回滚/降级：OpenAI / MiniMax 统一补同一类测试

## Test Plan

1. 工具直接失败：仍返回 `TOOL_EXEC_FAILED`，且 `actionJournal` 含 `finish-supervisor`
2. `ok -> fail`：最终仍返回真实失败，且 `finish-supervisor` 出现
3. 失败后 supervisor 连续 3 次 `CONTINUE`：返回 `FINISH_SUPERVISOR_BLOCKED`
4. MiniMax 路径失败：也会经过 finish supervisor
5. 正常成功路径：现有 supervisor 测试继续通过

## Observability

1. 继续沿用现有 `finish supervisor reviewed` 日志，不新增第二类结束日志
2. 真机验收以失败请求也能出现 `finish supervisor reviewed` 为准

（章节级）评审意见：[留空,用户将给出反馈]
