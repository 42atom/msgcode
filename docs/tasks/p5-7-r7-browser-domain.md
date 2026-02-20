# 任务单：P5.7-R7（浏览器域：browser）

优先级：P2（R6 通过后执行）

## 目标（冻结）

1. 落地浏览器原子命令：`open/click/type`。
2. CLI 层只暴露能力合同，不引入复杂状态机。
3. 全部命令可被 `help-docs --json` 发现。

## 依赖

1. 依赖 Playwright（或既有 browser executor）。
2. 依赖 R1c 硬门（真实成功/失败证据）。

## 范围

- `/Users/admin/GitProjects/msgcode/src/cli/browser.ts`
- `/Users/admin/GitProjects/msgcode/src/cli/help.ts`
- `/Users/admin/GitProjects/msgcode/test/*p5-7-r7*`
- `/Users/admin/GitProjects/msgcode/docs/tasks/README.md`

## 非范围

1. 不实现跨轮浏览器状态机编排。
2. 不改 agent run/status。

## 执行步骤（每步一提交）

1. `feat(p5.7-r7): add browser open click type commands`
2. `test(p5.7-r7): add browser-domain regression lock`

## 硬验收（必须全过）

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`
4. `help-docs --json` 可发现 browser
5. 真实成功证据：open + click/type
6. 真实失败证据：无效 selector / 无效 URL
7. 无新增 `.only/.skip`
