# 任务单：P5.7-R5-1（todo 命令合同收口）

优先级：P1

## 目标（冻结）

1. 落地 `msgcode todo add`。
2. 落地 `msgcode todo list`。
3. 落地 `msgcode todo done`。
4. 固定 `todo` 错误码与状态流，不允许语义漂移。

## 范围

- `/Users/admin/GitProjects/msgcode/src/cli/todo.ts`（新增或扩展）
- `/Users/admin/GitProjects/msgcode/src/cli/help.ts`（仅 todo 合同项）
- `/Users/admin/GitProjects/msgcode/test/*p5-7-r5-1*.test.ts`

## 非范围

1. 不改 schedule 命令。
2. 不改 memory/thread 逻辑。
3. 不改 runtime/tool loop。

## 执行步骤（单提交）

1. `feat(p5.7-r5-1): add todo add list done commands with fixed contract`

## 合同口径（冻结）

1. `todo add` 成功返回：`taskId/title/createdAt`。
2. `todo list` 返回：`count/items`，支持空列表成功。
3. `todo done` 成功返回：`taskId/doneAt/status=done`。
4. 非法 taskId 必须失败，错误码固定（建议 `TODO_NOT_FOUND`）。

## 硬验收

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`
4. 至少 1 条状态翻转证据（add -> done）
5. 无新增 `.only/.skip`
