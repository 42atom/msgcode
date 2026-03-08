# Plan: 修复执行型请求的"无工具假完成"断裂

## Problem

P0 松绑后，执行型请求出现两类断裂：

1. **假成功**：用户让删除 cron live，模型回复"已删除"但 toolCallCount=0
2. **伪工具文本穿透**：模型输出 `[TOOL_CALL]...` 直接漏给用户

## Occam Check

### 1. 不加这次改动，系统具体坏在哪？

执行型请求会"没做却说做了"，这是致命错误。

- 证据 1：`toolCallCount=0` + 回复"已停止并删除"但 cron 仍在运行
- 证据 2：`toolCallCount=0` + 回复包含 `[TOOL_CALL]` 伪文本

### 2. 用更少的层能不能解决？

能。

正确方向：
- 不禁止 allowNoTool（否则回到旧控制模式）
- 而是检测"执行意图但未执行"的场景，继续推进
- 移除 sanitize 后漏出的伪工具文本

### 3. 这个改动让主链数量变多了还是变少了？

目标：减少"假完成旁路"，回到真实执行主链。

## Decision

采用"检测+继续推进"策略：

1. **检测执行型提示词**：当 prompt 包含"删除/停止/创建/执行"等关键词，且 toolCallCount=0 时，触发继续推进
2. **检测伪工具文本**：当输出包含 `[TOOL_CALL]` 等协议 artifacts 时，触发继续推进
3. **继续推进方式**：不是新增 parser 硬执行，而是追加一轮强制工具调用请求

## 修改点

### 1. tool-loop.ts: 添加执行意图检测

在 `allowNoTool` 返回前，增加检测：

```typescript
// 检测是否为执行型请求但未执行工具
if (params.options.allowNoTool && toolCalls.length === 0) {
    const content = response.content || "";

    // 检测伪工具文本：[TOOL_CALL], <invoke>, <tool_call> 等
    if (hasToolProtocolArtifacts(content)) {
        // 有工具意图但未执行，推进一轮
        // 继续往下走，不提前返回
    } else if (looksLikeExecutionRequest(options.prompt) && !looksLikeCompletionResponse(content)) {
        // 执行型请求但模型没执行工具，继续推进
        // 继续往下走，不提前返回
    } else {
        // 真正的 no-tool 请求，可以直接返回
        return {
            answer: sanitizeLmStudioOutput(content),
            actionJournal: [],
            decisionSource: "model",
        };
    }
}
```

### 2. output-normalizer.ts: 移除伪工具协议 artifacts

在 `sanitizeLmStudioOutput` 中添加移除 `[TOOL_CALL]...[/TOOL_CALL]` 的逻辑。

### 3. routed-chat.ts: 条件化 allowNoTool

不再硬编码 `allowNoTool: true`，而是根据 prompt 类型动态决定。

## Plan

1. 在 tool-loop.ts 添加 `looksLikeExecutionRequest` 检测函数
2. 在 tool-loop.ts 的 allowNoTool 返回前增加执行意图检测
3. 在 output-normalizer.ts 添加伪工具文本移除逻辑
4. 在 routed-chat.ts 根据 prompt 类型条件化 allowNoTool
5. 补测试
6. 真机验证

## Risks

1. 检测逻辑可能误判：需要精细 tuning
2. 继续推进可能导致多轮空转：需要限制次数

## Test Plan

1. 执行型自然语言请求不能 `route=no-tool` 后宣称已完成
2. 伪 `[TOOL_CALL]` 文本不能作为最终回复
3. scheduler 删除类请求：若未真实执行，不得回复"已删除"
4. 保留松绑主线：read skill + bash 连续执行仍可用

---

**评审意见**：[留空，用户将给出反馈]
