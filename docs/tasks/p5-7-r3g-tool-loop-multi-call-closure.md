# 任务单：P5.7-R3g（Tool Loop 多工具闭环）

优先级：P0（当前主链关键缺口）

## 目标（冻结）

1. 将 tool loop 从“单轮仅首个工具”升级为“单轮多工具顺序执行”。
2. 每个 tool call 都进入统一执行与回灌链路。
3. 增加每轮工具步数上限，防止无限循环。

## 范围

- `src/lmstudio.ts`
- `src/providers/openai-compat-adapter.ts`（如需补 finishReason/解析字段）
- `test/*p5-7-r3g*.test.ts`（新增）

## 非范围

1. 不改 bash runner 细节（该项在 R3f）。
2. 不改错误 envelope 统一定义（该项在 R3h）。
3. 不引入新的工具名或 run_skill 链路。

## 实施步骤（每步一提交）

### R3g-1：执行循环升级

提交建议：`feat(p5.7-r3g): support sequential multi-tool calls per round`

1. 遍历 `tool_calls` 全量执行，不再只取 `[0]`。
2. 逐条执行并生成 tool result message。
3. 保持执行顺序确定性（FIFO）。

### R3g-2：回灌与收口

提交建议：`feat(p5.7-r3g): append all tool results before final summarize`

1. 所有工具结果回灌后再触发第二轮总结。
2. 第二轮仍强制 `toolChoice=none`，避免额外漂移。
3. 日志增加 `toolCallCount` 与每个 `toolName` 列表。

### R3g-3：防护与上限

提交建议：`feat(p5.7-r3g): add max tool steps guard`

1. 增加每轮步数上限（建议 `maxToolCallsPerTurn=8`）。
2. 超限返回结构化错误码（如 `TOOL_LOOP_LIMIT_EXCEEDED`）。

### R3g-4：回归锁

提交建议：`test(p5.7-r3g): add multi-tool loop regression lock`

1. 单轮 2~3 工具顺序执行测试。
2. 中间失败后错误定位测试。
3. 超限保护测试。

## 硬验收

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`
4. 单轮多工具场景可稳定完成
5. 失败时可定位 `toolCallId/toolName`
6. 无新增 `.only/.skip`

## 验收回传模板

```md
# P5.7-R3g 验收报告

## 提交
- <sha> <message>

## Gate
- npx tsc --noEmit:
- npm test:
- npm run docs:check:

## 关键证据
- multi-tool in one round:
- call order:
- limit guard:
```
