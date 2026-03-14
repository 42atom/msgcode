# 任务单：P5.7-R5-2（schedule 命令合同收口）

优先级：P1

## 目标（冻结）

1. 落地 `msgcode schedule add`。
2. 落地 `msgcode schedule list`。
3. 落地 `msgcode schedule remove`。
4. 固定 cron 校验与错误码语义，避免运行时口径漂移。

## 范围

- `/Users/admin/GitProjects/msgcode/src/cli/schedule.ts`（新增或扩展）
- `/Users/admin/GitProjects/msgcode/src/cli/help.ts`（仅 schedule 合同项）
- `/Users/admin/GitProjects/msgcode/test/*p5-7-r5-2*.test.ts`

## 非范围

1. 不改 todo 命令。
2. 不改现有 `/schedule` 路由语义（CLI 并行能力）。
3. 不引入自动编排黑盒命令。

## 执行步骤（单提交）

1. `feat(p5.7-r5-2): add schedule add list remove commands with fixed contract`

## 合同口径（冻结）

1. `schedule add` 成功返回：`scheduleId/cron/task/createdAt`。
2. `schedule list` 返回：`count/items`，支持空列表成功。
3. `schedule remove` 成功返回：`scheduleId/removedAt`。
4. 非法 cron 必须失败，错误码固定（建议 `SCHEDULE_INVALID_CRON`）。
5. 非法 schedule id 必须失败，错误码固定（建议 `SCHEDULE_NOT_FOUND`）。

## 硬验收

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`
4. 至少 1 条成功证据（add -> list -> remove）
5. 至少 1 条非法 cron 失败证据
6. 无新增 `.only/.skip`
