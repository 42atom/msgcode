# Plan: 按 OpenClaw 工具主链改造 - 去掉 allowNoTool 收尾链

## Problem

1. **allowNoTool 收尾链**：一轮没出 tool call 被 `route=no-tool -> MODEL_PROTOCOL_FAILED` 打死
2. **消息级裁判**：之前已删除 `looksLikeExecutionRequest`，但需确认完全移除
3. **工具暴露不一致**：`tool-loop.ts` 与 `lmstudio.ts` 语义可能不一致

## Occam Check

### 1. 不加这次改动，系统具体坏在哪？

- 一轮没出 tool call 就被 `route=no-tool -> MODEL_PROTOCOL_FAILED` 打死
- LLM 无法继续尝试，直接返回"协议失败"
- 同一句自然语言有时能进工具链，有时又掉回 no-tool

### 2. 用更少的层能不能解决？

能。正确方向：
- 删除 `allowNoTool` 和相关收尾逻辑
- 回到"完整工具面 + 配置过滤 + 参数归一化"
- `toolCallCount=0` 时继续循环，不判死

### 3. 这个改动让主链数量变多了还是变少了？

目标：消灭 no-tool 判死旁路，只保留一条真实工具主链。

## Decision

### msgcode vs OpenClaw 对照表

| 维度 | OpenClaw | msgcode | 状态 |
|------|----------|---------|------|
| 工具构建 | 默认完整工具集 | 有条件判断 | 待对齐 |
| 工具过滤 | 纯配置/权限 | 可能有消息级裁判 | 已部分删除 |
| allowNoTool | 无此概念 | 存在 | 待删除 |
| toolCallCount=0 | 继续循环 | 直接判死 | 待修复 |
| 参数归一化 | 有 | 无统一实现 | 可后续 |

### 改动内容

1. **删 allowNoTool 收尾链**
   - 删除 `allowNoTool` 作为执行链正常出口
   - `toolCallCount=0` 时继续循环，不直接返回

2. **删消息级裁判**（上次已完成）
   - 已删除 `looksLikeExecutionRequest`
   - 已删除 `looksLikeCompletionResponse`

3. **对齐工具暴露**
   - 确保 tool-loop.ts 与 lmstudio.ts 语义一致

4. **修复 finalRoute 伪装**
   - 不再固定 `finalRoute = "tool"`
   - 改为报告真实状态：`toolLoopResult.toolCall !== undefined ? "tool" : "no-tool"`

5. **修复 scheduler SKILL.md**
   - 强调 `add <schedule-id>` 中 schedule-id 是**位置参数**
   - 用户说"发：live cron"，schedule-id 就是 `live-cron`

## Plan

### 步骤 1: 检查 allowNoTool 使用位置

在 `tool-loop.ts` 和 `routed-chat.ts` 中查找：
- `allowNoTool` 的定义和调用
- `route=no-tool` 的处理逻辑

### 步骤 2: 删 allowNoTool 收尾链

**修改文件**：
- `src/agent-backend/tool-loop.ts`
- `src/agent-backend/routed-chat.ts`

**改动**：
1. 删除 `allowNoTool` 相关收尾逻辑
2. `toolCallCount=0` 时继续循环，不判死
3. 不再保留 `route=no-tool` 作为执行链正常出口

### 步骤 3: 对齐工具暴露

**修改文件**：
- `src/agent-backend/tool-loop.ts`
- `src/lmstudio.ts`

确保两者的工具暴露语义一致。

### 步骤 4: 补测试

**测试用例**：
1. 自然语言创建 schedule 不再 `route=no-tool`
2. `toolCallCount=0` 时不会直接 `MODEL_PROTOCOL_FAILED`
3. `lmstudio.ts` / `tool-loop.ts` 的工具暴露一致

### 步骤 5: 真机 smoke

**测试命令**：
1. `定一个每分钟发送的任务 发：live cron`
2. `现在可以停止发送 cron live了`

**期望结果**：
1. 两条都进入真实工具链
2. 不再 `route=no-tool`
3. 不再 `MODEL_PROTOCOL_FAILED`
4. 创建和停止都是真实执行，状态一致

## Risks

1. **旧逻辑残留**：删除 allowNoTool 后可能有遗留依赖
2. **模型行为变化**：需要重新调优

**回滚策略**：
- 如果 smoke 失败，保持 git branch 可回滚

---

**评审意见**：[留空，用户将给出反馈]
