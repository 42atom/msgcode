# 任务单：P5.7-R3h（工具失败合同与诊断增强）

优先级：P0（失败不可诊断是当前主要阻塞）

## 目标（冻结）

1. 统一工具失败 envelope，保证错误可归因。
2. 明确区分三类失败：协议失败、工具失败、展示为空失败。
3. 保证每次失败都可定位到 `toolName/toolCallId/errorCode`。

## 范围

- `src/lmstudio.ts`
- `src/tools/bus.ts`
- `src/providers/openai-compat-adapter.ts`
- `test/*p5-7-r3h*.test.ts`（新增）
- `docs/product/msgcode-tool-loop-slo-v1.md`（若引用字段需同步）

## 非范围

1. 不改能力面（不新增命令）。
2. 不改模型路由策略（该项在 R3j）。
3. 不改 SLO 阈值（该项在 R3k）。

## 合同口径（冻结）

统一结果 envelope（建议）：

1. `ok: boolean`
2. `data?: unknown`
3. `errorCode?: string`
4. `error?: string`
5. `exitCode?: number`
6. `stdoutTail?: string`
7. `stderrTail?: string`
8. `fullOutputPath?: string`

失败类型：

1. `MODEL_PROTOCOL_FAILED`
2. `TOOL_EXEC_FAILED`
3. `EMPTY_DISPLAY_OUTPUT`

## 实施步骤（每步一提交）

### R3h-1：失败分类与字段定义

提交建议：`feat(p5.7-r3h): define normalized tool failure envelope`

1. 统一失败字段与错误码枚举。
2. 建立从 Tool Bus 到 Tool Loop 的错误透传链。

### R3h-2：Tool Loop 透传改造

提交建议：`fix(p5.7-r3h): preserve exit code and stderr tails in loop errors`

1. 工具失败时不再只返回通用错误文本。
2. 保留 `exitCode/stderrTail/fullOutputPath`。

### R3h-3：日志与观测

提交建议：`feat(p5.7-r3h): add diagnostic fields for tool failures`

1. 日志落 `toolCallId/toolName/errorCode/exitCode`。
2. 区分协议层失败与工具执行失败。

### R3h-4：回归锁

提交建议：`test(p5.7-r3h): add tool failure diagnostics regression lock`

1. 非零退出码保真测试。
2. stderr 尾部透传测试。
3. 空展示输出分类测试。

## 硬验收

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`
4. 工具失败不再丢失 `exitCode/stderrTail`
5. 失败类型三分可断言
6. 无新增 `.only/.skip`

## 验收回传模板

```md
# P5.7-R3h 验收报告

## 提交
- <sha> <message>

## Gate
- npx tsc --noEmit:
- npm test:
- npm run docs:check:

## 关键证据
- error envelope:
- TOOL_EXEC_FAILED diagnostics:
- MODEL_PROTOCOL_FAILED vs EMPTY_DISPLAY_OUTPUT:
```
