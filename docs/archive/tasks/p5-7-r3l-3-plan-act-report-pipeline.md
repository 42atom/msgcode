# 任务单：P5.7-R3l-3（Plan -> Act -> Report 管道）

优先级：P0

## 目标（冻结）

1. 将工具链路显式化为三阶段：`plan -> act -> report`。
2. 当前阶段保持两类入口：`no-tool` 与 `tool`；复杂任务先复用 `tool` 入口。
3. 阶段失败可诊断，不允许静默吞错。

## 范围

- `/Users/admin/GitProjects/msgcode/src/lmstudio.ts`
- `/Users/admin/GitProjects/msgcode/src/handlers.ts`
- `/Users/admin/GitProjects/msgcode/test/*p5-7-r3l-3*.test.ts`

## 非范围

1. 不实现新分类器模型。
2. 不改 tmux 链路。

## 执行步骤（每步一提交）

1. `feat(p5.7-r3l-3): add explicit plan-act-report pipeline for tool route`
2. `test(p5.7-r3l-3): add phase-order regression lock`

## 硬验收

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`
4. 日志 phase 顺序固定：`plan -> act -> report`
