# 任务单：Agent 追打型未完成任务闭环

## 结论

本轮不是“多加几次 tool retry”，也不是“让用户再发一句继续”。  
本轮要做的是：把 `msgcode` 从“会话型 agent”推进到“目标型 agent supervisor”的最小闭环。

## 唯一真相源

- Issue：`issues/0006-agent-relentless-task-closure.md`
- Plan：`docs/design/plan-260306-agent-relentless-task-closure.md`
- Dispatch：`AIDOCS/design/dispatch-260306-agent-relentless-task-closure.md`

若实现过程发现历史任务单口径冲突，以 Issue + Plan 当前内容为准。

## 本轮范围

必须实现：

1. 建立 agent 任务状态机
   - 固定状态：`pending | running | blocked | completed | failed | cancelled`
2. 建立任务持久化存储
3. 建立任务事件队列持久化与重启恢复
4. 建立 `task-supervisor`
   - 用户发起任务后创建任务对象
   - heartbeat 负责继续推进未完成任务
5. 将 verify 纳入完成判定
   - 没有 verify 证据不得 `completed`
6. 建立最小控制面
   - `task status`
   - `task cancel`
   - `task resume`（或等价恢复命令）
7. 补回归锁与真实恢复证据

建议涉及文件：

1. `src/runtime/task-types.ts`（新建）
2. `src/runtime/task-store.ts`（新建）
3. `src/runtime/task-queue.ts` 或 `src/runtime/event-queue-store.ts`（新建）
4. `src/runtime/task-supervisor.ts`（新建）
5. `src/commands.ts`
6. `src/handlers.ts`
7. `src/agent-backend/routed-chat.ts`
8. `src/agent-backend/tool-loop.ts`
9. `src/agent-backend/types.ts`
10. `src/routes/cmd-task.ts` 或等价控制入口（新建）
11. `test/p5-7-r12-agent-relentless-task-closure.test.ts`（新建）

## 非范围 / 禁止扩 scope

本轮禁止实现：

1. 多 chat 多活跃任务调度
2. 多代理协作
3. 外部 MQ / Redis
4. UI
5. 新 provider 适配
6. 重写 tmux 主链
7. 把所有消息都自动升级成 task

## 实现顺序

1. 先做任务状态机与任务存储
   - 保证任务是第一类对象，不再只是消息轮次
   - 字段至少包含：
     - `taskId`
     - `chatId`
     - `workspacePath`
     - `goal`
     - `status`
     - `attemptCount`
     - `lastErrorCode`
     - `blockedReason`
     - `nextWakeAtMs`

2. 再做事件队列持久化
   - 状态至少包含：`queued -> processing -> done|failed`
   - 重启后能恢复 `queued|processing`

3. 再做 task-supervisor
   - 用户触发任务时创建 task
   - heartbeat tick 扫描并继续推进可执行任务
   - 单 chat 只允许一个活跃任务

4. 再接 verify gate
   - 没有验证证据不允许 `completed`
   - 人机接力场景转 `blocked`

5. 最后补最小控制面和测试
   - 状态查询
   - 取消
   - 恢复

## 硬验收

1. 同一 chat 下，任务在无新用户消息情况下可继续推进，直到进入终态
2. 进程重启后，`pending|running|blocked` 任务可恢复
3. 无 verify 证据时，任务不能进入 `completed`
4. 需人工接力时，任务进入 `blocked`，并保留恢复上下文
5. 能输出结构化任务诊断：
   - `taskId`
   - `status`
   - `attemptCount`
   - `nextWakeAtMs`
   - `lastErrorCode`
   - `blockedReason`
6. 三门通过：
   - `npx tsc --noEmit`
   - `npm test`
   - `npm run docs:check`
7. 无新增 `.only/.skip`

## 已知坑

1. 不要一上来做多任务并发；先锁死“单 chat 单活跃任务”
2. 不要只接 heartbeat，不做任务持久化；那样只是“有唤醒，无任务对象”
3. 不要绕过 verify 直接标记完成
4. 不要把需人工接力场景继续自动重试；必须进 `blocked`
5. 不要只做内存队列；本轮核心就是重启恢复

## 交付格式

执行完成后，回传必须使用以下结构：

任务：Agent 追打型未完成任务闭环
原因：
- 当前只有单轮 tool loop，没有跨轮任务闭环
- heartbeat/scheduler 已有底座，但未接任务恢复
过程：
- 新增任务状态机与任务存储
- 新增持久化事件队列与重启恢复
- 新增 task-supervisor 并接入 heartbeat
- 将 verify 接入完成判定
- 补控制面与回归锁
结果：
- `msgcode` 可在无新消息时继续追打未完成任务
- 重启后未完成任务不会静默丢失
- blocked/completed/failed 终态清晰可诊断
验证：
- 列出三门命令与关键输出
- 列出至少一条“重启恢复继续执行”的真实证据
- 列出至少一条“无 verify 不得 completed”的证据
风险 / 卡点：
- 说明是否仍有旧入口绕过 supervisor
- 说明是否仍存在内存态队列残留
后续：
- 若 MVP 稳定，再评估多任务与多代理扩展

## 给执行同学的一句话

先把“任务”变成第一类持久对象，再谈死磕；别把它继续做成“消息轮次 + 用户手动继续”的伪闭环。
