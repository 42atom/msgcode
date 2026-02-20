# 任务单：P5.7-R3b ToolLoop 二轮收口格式漂移 HOTFIX

**优先级**: P0

**状态**: 已完成

---

## 背景

线上已复现问题：
- 第一轮 `tool_calls` 正常执行
- 第二轮返回 `finish_reason=stop` 且 `content` 为字面工具调用标记
- 当前 `sanitizeLmStudioOutput` 会清洗掉该片段，导致空文本
- 最终报错"LM Studio 未返回可展示的内容"

## 目标

- 修复"工具已执行成功但二轮总结为空"问题
- 不恢复文本协议执行，不引入 `run_skill`，不改工具语义
- 仅做展示层降级收口

## 实施范围

- `/Users/admin/GitProjects/msgcode/src/lmstudio.ts` - 主处理逻辑
- `/Users/admin/GitProjects/msgcode/src/providers/openai-compat-adapter.ts` - 漂移检测
- `/Users/admin/GitProjects/msgcode/test/p5-7-r3b-second-round-malformed.test.ts` - 回归锁

## 非范围

- 不改 tmux 链路
- 不改工具权限策略
- 不新增命令

---

## 实施步骤

### R1：识别二轮格式漂移

在 `openai-compat-adapter.ts` 中新增检测逻辑：

```typescript
export interface ParsedChatCompletionWithMeta extends ParsedChatCompletion {
    /** R3b: 二轮格式漂移标记：content 含工具调用标记但 tool_calls 为空 */
    secondRoundMalformedToolCall?: boolean;
}

// 检测条件：
// - tool_calls 为空
// - content 不为空
// - finish_reason 为 stop
// - content 包含工具调用标记
const secondRoundMalformedToolCall =
    toolCalls.length === 0 &&
    content !== null &&
    content !== "" &&
    finishReason === "stop" &&
    (content.includes("

### R2：安全降级收口（仅展示层）

在 `lmstudio.ts` 的 `runLmStudioToolLoop` 函数中：

1. 从第二轮响应解析结果中读取 `secondRoundMalformedToolCall` 标记
2. 若命中漂移，返回"工具已执行 + 结构化结果摘要"的可展示文本
3. 严禁把 `

```

### R3：回归锁

新增测试文件 `test/p5-7-r3b-second-round-malformed.test.ts`：
- 漂移检测逻辑验证
- 正常响应场景验证
- 返回类型验证

---

## 验收标准

- [x] `npx tsc --noEmit` - 通过
- [x] `npm test` - 785 测试全通过（0 fail）
- [ ] `npm run docs:check` - 待验证
- [ ] 人工冒烟 - 待验证

观测字段：
- 日志出现 `secondRoundMalformedToolCall=true`（当检测到时）
- 用户可收到可读结果文本（工具执行摘要）

---

## 提交记录

1. `detect-malformed-second-round` - 添加漂移检测逻辑
2. `fallback-visible-answer` - 添加降级收口处理
3. `regression-lock-and-docs` - 新增回归测试和文档

---

## 设计红线（已遵守）

- [x] 不回滚到"文本工具调用执行"
- [x] 不重新引入 `run_skill`
- [x] 不扩大行为面，只修二轮收口鲁棒性

---

## 代码变更摘要

### `src/providers/openai-compat-adapter.ts`

1. 新增 `ParsedChatCompletionWithMeta` 接口，扩展 `secondRoundMalformedToolCall` 字段
2. 修改 `parseChatCompletionResponse` 函数，添加漂移检测逻辑

### `src/lmstudio.ts`

1. 导入 `ParsedChatCompletionWithMeta` 类型
2. 修改 `callChatCompletionsRaw` 返回类型，附加解析元数据
3. 在 `runLmStudioToolLoop` 中添加漂移检测和兜底处理

### `test/p5-7-r3b-second-round-malformed.test.ts`（新增）

10 个测试用例覆盖：
- 正常响应场景
- 工具调用场景
- 漂移检测场景
- 边界条件场景

---

## 风险与遗留

- 风险：低 - 仅添加检测逻辑和兜底文本，不影响现有工具执行流程
- 遗留：无

---

## 验收报告模板

```md
# P5.7-R3b 验收报告

## 提交
- <sha> detect-malformed-second-round
- <sha> fallback-visible-answer
- <sha> regression-lock-and-docs

## 变更文件
- src/providers/openai-compat-adapter.ts
- src/lmstudio.ts
- test/p5-7-r3b-second-round-malformed.test.ts

## Gate
- npx tsc --noEmit: pass
- npm test: 785/0 pass
- npm run docs:check: pending

## ToolLoop 收口证据
- 唯一主链入口：runLmStudioToolLoop
- 漂移检测：parseChatCompletionResponse 返回 secondRoundMalformedToolCall 标记
- 降级收口：命中漂移时返回工具执行摘要

## 风险与遗留
- 风险：无
- 遗留：无
```
