# 任务单：P5.7-R3l-1（Tool 协议硬门）

优先级：P0

## 目标（冻结）

1. 在 tool 路由中，`toolCallCount=0` 时禁止输出“像执行过”的文本。
2. 统一返回协议失败文案与错误码：`MODEL_PROTOCOL_FAILED`。
3. 日志必须记录失败原因与判定依据。

## 范围

- `/Users/admin/GitProjects/msgcode/src/lmstudio.ts`
- `/Users/admin/GitProjects/msgcode/test/*p5-7-r3l-1*.test.ts`

## 非范围

1. 不改 tool schema。
2. 不改 CLI 命令面。

## 执行步骤（每步一提交）

1. `fix(p5.7-r3l-1): hard-fail on tool route without tool_calls`
2. `test(p5.7-r3l-1): add protocol hard-gate regression lock`

## 硬验收

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`
4. tool 路由 `toolCallCount=0` 时必须返回固定失败回执
5. 日志含 `errorCode=MODEL_PROTOCOL_FAILED`
