# 任务单：P5.7-R3l-2（Dialog/Exec Prompt 拆分）

优先级：P0

## 目标（冻结）

1. 拆分提示词构建函数：
   - `buildDialogSystemPrompt(...)`
   - `buildExecSystemPrompt(...)`
2. `dialog` 链路允许 SOUL；`exec` 链路禁止 SOUL。
3. 保持最小实现，不引入额外策略层。

## 范围

- `/Users/admin/GitProjects/msgcode/src/lmstudio.ts`
- `/Users/admin/GitProjects/msgcode/test/*p5-7-r3l-2*.test.ts`

## 非范围

1. 不改路由策略算法。
2. 不新增模型供应商。

## 执行步骤（每步一提交）

1. `refactor(p5.7-r3l-2): split dialog and exec prompt builders`
2. `test(p5.7-r3l-2): add soul-injection boundary regression lock`

## 硬验收

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`
4. `kernel=exec` 时 `soulInjected=false`
5. `kernel=dialog` 时 `soulInjected=true`
