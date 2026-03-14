# Plan: Agent 追打型未完成任务闭环

Issue: 0006

## Problem

当前 `msgcode` 已经具备“单轮内多步推进”的能力，但还不具备“跨轮、跨重启、无人盯着也继续追打未完成任务”的能力。

代码现状：

1. `src/agent-backend/tool-loop.ts` 只负责单次请求内的 while-loop，不负责任务生命周期
2. `src/steering-queue.ts` 明确是 in-memory queue，重启即丢
3. `src/runtime/heartbeat.ts` 已存在，但当前 `src/commands.ts` 只把它当观测心跳，不负责恢复未完成任务
4. `src/jobs/scheduler.ts` 能恢复 stuck jobs，但当前 job payload 只支持 `tmuxMessage`
5. `docs/tasks/p5-7-r8-agent-domain.md` 中的 agent run/status 状态机仍停留在任务单

因此，`msgcode` 现在更像“会话型 agent + 长会话 tmux 通道”，而不是“目标型 agent supervisor”。  
如果不补任务状态机和恢复闭环，系统就无法像 OpenClaw 一样把“目标未完成”视为一个持续推进的对象。

## Decision

采用“**单 chat、单活跃任务的追打型任务闭环 MVP**”方案。

核心决策：

1. 先只支持 **单 chat 单活跃任务**，不做多任务并发与多代理协作
2. 为 agent 任务建立持久化状态机：`pending | running | blocked | completed | failed | cancelled`
3. 建立任务存储 + 事件队列存储，重启后恢复 `pending|running|blocked`
4. 由 heartbeat 统一驱动“无新消息时的继续推进”
5. 将 `verify` 纳入完成判定，无验证证据不得进入 `completed`
6. 人机接力场景一律进入 `blocked`，等待明确恢复信号

核心理由：

1. 先收口状态空间，避免一上来做成“多任务 + 多代理 + 多队列”的大爆炸
2. heartbeat、scheduler、verify、event queue 这些现有底座都能复用，不必另起炉灶
3. 只有先把“任务”从“消息轮次”中独立出来，后续才谈得上持续追打与恢复

（章节级）评审意见：[留空,用户将给出反馈]

## Alternatives

1. 继续沿用当前会话模型，靠用户不断发“继续”
   - 优点：改动最小
   - 缺点：这不是真正的任务闭环，也无法跨重启恢复

2. 直接做多任务、多代理 supervisor
   - 优点：一步到位
   - 缺点：状态空间爆炸，当前仓库没有准备好

3. 单 chat、单活跃任务的持久化追打闭环（推荐）
   - 优点：足够接近目标，且实现可控
   - 缺点：后续若要多任务，需要再扩状态机与调度策略

（章节级）评审意见：[留空,用户将给出反馈]

## Plan

1. 建立任务状态机与持久化存储
   - 文件建议：
     - `src/runtime/task-store.ts`（新建）
     - `src/runtime/task-types.ts`（新建）
   - 内容：
     - `TaskRecord`
     - 固定状态：`pending/running/blocked/completed/failed/cancelled`
     - 关键字段：`taskId/chatId/workspacePath/goal/attemptCount/lastErrorCode/blockedReason/nextWakeAtMs`
   - 验收：
     - 任务可落盘并重载

2. 建立任务事件队列与恢复入口
   - 文件建议：
     - `src/runtime/task-queue.ts`（新建）或复用/升级 `src/steering-queue.ts`
     - `src/runtime/event-queue-store.ts`（新建，若沿用 R12-T4 口径）
   - 内容：
     - 队列状态：`queued -> processing -> done|failed`
     - 启动恢复：重载未完成事件
   - 验收：
     - 重启后 `queued|processing` 事件不丢

3. 引入任务监督器（supervisor）
   - 文件建议：
     - `src/runtime/task-supervisor.ts`（新建）
     - `src/commands.ts`
     - `src/handlers.ts`
   - 内容：
     - 用户发起目标时创建任务
     - 任务执行后根据结果推进状态
     - heartbeat tick 负责扫描并继续可执行任务
   - 验收：
     - 无新消息也能继续推进同一任务

4. 将 verify 纳入完成判定
   - 文件建议：
     - `src/agent-backend/routed-chat.ts`
     - `src/agent-backend/tool-loop.ts`
     - `src/agent-backend/types.ts`
   - 内容：
     - 复用/接入 `verify` phase
     - 只有 verify 成功才允许 `completed`
   - 验收：
     - 无验证证据不能标记完成

5. 建立最小控制面
   - 文件建议：
     - `src/routes/cmd-task.ts` 或等价控制入口（新建）
     - `src/cli/help.ts`
   - 内容：
     - `task status`
     - `task cancel`
     - `task resume`（或等价恢复命令）
   - 验收：
     - 可查看当前任务状态与阻塞原因

6. 补测试与真实恢复证据
   - 文件建议：
     - `test/p5-7-r12-agent-relentless-task-closure.test.ts`（新建）
   - 内容：
     - 创建任务 -> 中断进程 -> 重启恢复
     - blocked -> resume
     - verify gate
   - 验收：
     - 有真实恢复与终态转换证据

## Risks

1. 风险：一上来支持多任务，导致 lane、队列、状态机互相串味
   - 回滚/降级：本轮严格限制为单 chat 单活跃任务

2. 风险：恢复逻辑只补 heartbeat，不补任务存储，仍会出现“有唤醒，无对象”
   - 回滚/降级：任务存储与恢复入口必须一起落地

3. 风险：没有 verify gate，系统会把“还没证据的执行”错误标为完成
   - 回滚/降级：completed 必须依赖 verify 成功

4. 风险：blocked 场景处理不清，导致无限重试自旋
   - 回滚/降级：需人工接力时必须转 `blocked`，不允许继续自动执行

5. 风险：兼容入口过多，部分链路继续绕过 supervisor
   - 回滚/降级：所有任务型执行入口统一经 `task-supervisor`

（章节级）评审意见：[留空,用户将给出反馈]

## Migration / Rollout

1. 第一步：先仅在 agent 线启用，tmux 线保持现状
2. 第二步：默认只对“明确任务型请求”建 task，不对所有闲聊自动建 task
3. 第三步：观察恢复链路稳定后，再评估是否扩展到更多场景
4. 回滚开关：
   - supervisor 可通过配置关闭
   - 关闭后退回当前“会话型 agent”行为

（章节级）评审意见：[留空,用户将给出反馈]

## Test Plan

1. 单测：
   - 状态机合法转换锁
   - blocked 不得自动重试
   - verify 失败不得 completed

2. 集成：
   - 创建任务 -> heartbeat 续跑 -> 终态
   - 任务运行中重启 -> 恢复继续
   - blocked -> resume -> 继续执行

3. 验证命令：
   - `npx tsc --noEmit`
   - `npm test`
   - `npm run docs:check`

（章节级）评审意见：[留空,用户将给出反馈]

## Observability

建议统一日志/诊断字段：

1. `taskId`
2. `chatId`
3. `status`
4. `attemptCount`
5. `eventId`
6. `nextWakeAtMs`
7. `lastErrorCode`
8. `blockedReason`
9. `verifyStatus`

至少在任务文件与日志中都可直接 grep/回放，确保排障不靠猜。

（章节级）评审意见：[留空,用户将给出反馈]
