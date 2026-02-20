# 任务单：P5.7-R5（编排与调度域：todo + schedule）

优先级：P1（R4 通过后执行）

## 目标（冻结）

1. 落地 `todo` 命令：`add/list/done`。
2. 落地 `schedule` 命令：`add/list/remove`。
3. 保持命令原子性，不引入黑盒“全自动编排”命令。
4. 全部命令进入 `help-docs --json` 合同。

## 依赖

1. todo 可独立存储（Markdown/JSON 任一，但口径需固定）。
2. schedule 依赖现有调度器与 cron 解析能力。
3. 不改现有 `/schedule` 路由命令语义，CLI 作为并行基座能力。

## 范围

- `/Users/admin/GitProjects/msgcode/src/cli/todo.ts`（新增或扩展）
- `/Users/admin/GitProjects/msgcode/src/cli/schedule.ts`（新增或扩展）
- `/Users/admin/GitProjects/msgcode/src/cli/help.ts`
- `/Users/admin/GitProjects/msgcode/test/*p5-7-r5*`
- `/Users/admin/GitProjects/msgcode/docs/tasks/README.md`

## 非范围

1. 不改 memory/thread 语义。
2. 不改 agent run/status。

## 执行步骤（每步一提交）

1. `feat(p5.7-r5): add todo add list done commands`
2. `feat(p5.7-r5): add schedule add list remove commands`
3. `test(p5.7-r5): add todo-schedule regression lock`

## 硬验收（必须全过）

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`
4. `help-docs --json` 可发现 todo/schedule
5. 真实成功证据：todo 状态翻转 + schedule 新增后可列出
6. 真实失败证据：非法 cron / 非法 task id
7. 无新增 `.only/.skip`
