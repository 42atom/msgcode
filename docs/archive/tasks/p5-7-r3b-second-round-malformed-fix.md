# 任务单：P5.7-R3b ToolLoop 二轮格式漂移 HOTFIX（最终版）

**优先级**: P0  
**状态**: 已完成并签收

---

## 背景

线上复现的失败链路：
1. 第一轮返回标准 `tool_calls` 并执行成功。
2. 第二轮返回 `finish_reason=stop`，但 `content` 是字面 `<tool_call>...</tool_call>`。
3. 输出清洗会移除该片段，导致最终空文本并报错：
   `LM Studio 未返回可展示的文本`。

---

## 最终口径

1. **R1 严格模式**：第一轮仅认结构化 `tool_calls`，不再从 `content` 反解析并执行工具。  
2. **R2 宽容展示**：第二轮若命中“格式漂移”（XML 工具调用块落在 content），走展示层兜底，返回“工具已执行结果摘要”。  
3. **不回流文本协议执行**，不引入 `run_skill`。

---

## 实施范围

- `/Users/admin/GitProjects/msgcode/src/providers/openai-compat-adapter.ts`
- `/Users/admin/GitProjects/msgcode/src/lmstudio.ts`
- `/Users/admin/GitProjects/msgcode/test/p5-7-r3b-second-round-malformed.test.ts`

---

## 关键实现

### 1) 漂移检测（R2）

在 `parseChatCompletionResponse` 中增加稳定检测：

```ts
const toolCallPattern = /<tool_call\b[\s\S]*?<\/tool_call\s*>/i;
const secondRoundMalformedToolCall =
  toolCalls.length === 0 &&
  content !== null &&
  content !== "" &&
  finishReason === "stop" &&
  toolCallPattern.test(content);
```

### 2) 二轮兜底展示

在 ToolLoop 第二轮汇总阶段，如果 `secondRoundMalformedToolCall=true`：
- 记录观测日志；
- 生成“工具执行结果摘要”作为可展示文本；
- 避免空响应透出到 handler。

### 3) 第一轮执行边界

第一轮保持严格：
- 仅执行结构化 `tool_calls`；
- 无结构化调用时，直接走“无工具调用”分支；
- 禁止从 `content` 进行 best-effort 执行。

---

## 回归锁

`test/p5-7-r3b-second-round-malformed.test.ts` 覆盖：
- 正例（命中漂移）：2 条（`<tool_call>` 标签场景）；
- 负例（不命中）：4 条（正常文本/正常 tool_calls/空内容/非 stop）。

---

## 验收结果

- `npx tsc --noEmit`：通过  
- `npm test`：`781 pass / 0 fail`  
- `npm run docs:check`：通过

---

## 风险与遗留

- 风险：低。仅增强漂移识别与展示兜底，不改变工具语义。  
- 遗留：若后续出现 JSON 形态的非标准二轮漂移，再按独立任务扩展检测规则。
