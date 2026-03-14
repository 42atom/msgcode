# 任务单：P5.7-R3l-4（action_journal 状态回写）

优先级：P1

## 目标（冻结）

1. 落地最小 `action_journal` 契约，作为 report 阶段事实源。
2. 固定字段：
   - `traceId, stepId, tool, ok, exitCode, errorCode, stdoutTail, durationMs`
3. report 阶段必须消费 journal，不得“脑补执行细节”。

## 范围

- `/Users/admin/GitProjects/msgcode/src/lmstudio.ts`
- `/Users/admin/GitProjects/msgcode/src/tools/*`（如需最小透传）
- `/Users/admin/GitProjects/msgcode/test/*p5-7-r3l-4*.test.ts`

## 非范围

1. 不扩展为完整审计系统。
2. 不引入外部追踪平台。

## 执行步骤（每步一提交）

1. `feat(p5.7-r3l-4): add minimal action-journal contract`
2. `test(p5.7-r3l-4): add journal-to-report traceability lock`

## 硬验收

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`
4. report 内容可由 journal 字段反向核验
