# Plan: LLM 松绑 Phase 2 移除控制逻辑

## Problem

主链虽然已经能真实执行 `read_file + bash` 与 schedule，但 `prompt.ts` 和 `tool-loop.ts` 里仍然残留传统控制软件思路：先规定流程、再按 preferred tool 顺序裁判、最后用低位 hard cap 截断循环。这些逻辑已经不再保护系统，反而继续制造潜在阻断。

## Occam Check

1. 不加这次改动，系统具体坏在哪？
   主链能跑只是碰巧跑通；遇到别的复杂任务时，prompt 强控制、preferred mismatch 和 20/64 的 hard cap 仍可能把正常工具链提前打死。
2. 用更少的层能不能解决？
   可以。直接删掉旧控制逻辑，不新增替代裁判层。
3. 这个改动让主链数量变多了还是变少了？
   变少。目标是回到“默认给工具、按配置过滤、拿真实结果”的单一执行主链。

## Decision

采用“删控制，不换控制”的 Phase 2：

1. prompt 只保留真实结果、不伪造执行等底线，不再规定固定流程。
2. tool-loop 删除 preferred-tool / mismatch / 强制 tool_calls 重试裁判器。
3. 默认 quota 抬高到 99+ 次以上，显式低限额仅作为测试或配置边界，不再用低位 hard cap 卡住默认主链。
4. `lmstudio.ts` 和 `tool-loop.ts` 继续共用同一套工具暴露语义；若已有一致性，则通过测试锁住，不额外加层。

## Alternatives

### 方案 A：保留 preferred-tool，但提示词更温和

不选。只是把旧控制换个语气，思想没删。

### 方案 B：新增 supervisor/review loop 来替代旧裁判器

不选。会新增层数，和本轮 Occam 方向相反。

## Plan

1. 修改 `src/agent-backend/prompt.ts`
   - 删除 `最多 3 次`
   - 删除 `第一轮必须 tool_calls`
   - 删除 `没有 tool_calls 前禁止直接回答`
   - 保留：真实结果、先取事实、禁止伪造执行
2. 修改 `src/agent-backend/tool-loop.ts`
   - 删除 `detectPreferredToolName`
   - 删除 `allowsBashFallback`
   - 删除 `selectActiveToolNames`
   - 删除 `buildToolFallbackInstruction`
   - 删除 `hasDisallowedPreferredToolMismatch`
   - 删除 `findUnexpectedToolNames`
   - 删除相关“你必须调用工具”的 retry 分支
   - 保留明确的工具执行失败边界
3. 调整默认 quota
   - 默认档位改为 99+ 次调用
   - hard cap 改为远高于默认，不再在普通任务中先于配置边界命中
   - 允许显式低限额继续用于测试/配置
4. 对齐 `src/lmstudio.ts`
   - 验证兼容层与主实现工具暴露语义一致
   - 用测试锁住一致性
5. 测试与 smoke
   - prompt 文案回归
   - 无 tool_calls 不再返回 `MODEL_PROTOCOL_FAILED`
   - 21+ 次工具调用在高限额下不再被旧 hard cap 截断
   - read skill / bash / schedule 主链回归
   - 真机 smoke：一个多轮 `read_file + bash` 任务，一个文件/浏览器复杂任务

## Risks

1. 旧测试大量基于旧控制逻辑，会出现冻结合同反转。
   - 回滚：保留新主链，更新测试到新合同；不回退删掉的控制层。
2. 模型在没有强制 retry 时，可能更早返回文本。
   - 处理：保留 prompt 的“真实结果/不伪造”底线，不再用流程命令替代能力。
3. quota 抬高后，坏循环的运行时间会增加。
   - 处理：保留显式配置边界与任务预算边界，不保留低位默认 hard cap。

## Test Plan

1. prompt 文案测试：
   - 不再出现 `最多 3 次`
   - 不再出现 `第一轮必须`
   - 不再出现 `没有 tool_calls 前禁止直接回答`
2. tool-loop 行为测试：
   - 无 tool_calls 返回模型真实响应，不再 `MODEL_PROTOCOL_FAILED`
   - 21 次以上工具调用在高限额下不再被旧 hard cap 截断
   - 显式低限额仍可触发 `TOOL_LOOP_LIMIT_EXCEEDED`
3. 主链回归：
   - `test/p5-7-r15-agent-read-skill-bridge.test.ts`
   - `test/p5-7-r18-schedule-refresh-on-mutation.test.ts`

## Observability

重点观察：

1. `MODEL_PROTOCOL_FAILED`
2. `TOOL_LOOP_LIMIT_EXCEEDED`
3. `Tool Bus: SUCCESS read_file`
4. `Tool Bus: SUCCESS bash`

目标：

1. 前两者不再因为旧控制逻辑触发
2. 后两者在复杂任务中能连续出现

评审意见：[留空,用户将给出反馈]
