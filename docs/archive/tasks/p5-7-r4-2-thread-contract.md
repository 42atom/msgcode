# 任务单：P5.7-R4-2（thread 命令与 active 强确认）

优先级：P1

## 目标（冻结）

1. 落地 `msgcode thread list`。
2. 落地 `msgcode thread messages`。
3. 落地 `msgcode thread active`。
4. 落地 `msgcode thread switch`，并返回 active thread snapshot 强确认。

## 范围

- `/Users/admin/GitProjects/msgcode/src/cli/thread.ts`（新增或扩展）
- `/Users/admin/GitProjects/msgcode/src/cli/help.ts`（仅 thread 合同项）
- `/Users/admin/GitProjects/msgcode/test/*p5-7-r4-2*.test.ts`

## 非范围

1. 不改 memory 存储结构。
2. 不改 runtime 路由。
3. 不改 schedule/todo。

## 执行步骤（单提交）

1. `feat(p5.7-r4-2): add thread list messages active switch commands`

## 合同口径（冻结）

1. `thread switch` 成功时必须返回：
   - `activeThreadId`
   - `activeThreadTitle`（若存在）
   - `switchedAt`
2. 切换到无效 thread id 必须失败，错误码固定。
3. `thread active` 在无活动线程时返回可诊断失败，不返回伪成功。

## 硬验收

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`
4. `thread switch` 成功与失败链路各至少 1 条
5. 无新增 `.only/.skip`
