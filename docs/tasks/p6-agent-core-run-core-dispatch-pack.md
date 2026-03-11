# Agent Core Run Core 派发包

## 任务一句话

把 `msgcode` 现有“普通消息 / `/task` / heartbeat / schedule”四条执行路径，收口成统一的 **run lifecycle 主链**，但不引入 gateway、不新增控制平台。

## 唯一真相源

- Issue:
  - [0066-openclaw-agent-core-gap-analysis.md](/Users/admin/GitProjects/msgcode/issues/0066-openclaw-agent-core-gap-analysis.md)
- Research:
  - [research-260310-openclaw-agent-core-gap.md](/Users/admin/GitProjects/msgcode/docs/notes/research-260310-openclaw-agent-core-gap.md)
- Plan:
  - [plan-260310-agent-core-gap-vs-openclaw.md](/Users/admin/GitProjects/msgcode/docs/design/plan-260310-agent-core-gap-vs-openclaw.md)

## 核心原则

1. 简单聊天也必须有 `runId`
2. 但简单聊天默认是 **轻量 run**
3. **run 不等于 task**
4. 只有满足长期推进条件时，run 才升级或关联到 task
5. 不做 gateway，不做 pairing，不做新进程，不做 transport platform

## 概念冻结

### Run

每次 agent 执行的最小统一对象。

适用来源：

- 普通消息
- `/task`
- heartbeat
- schedule

### Light Run

普通聊天默认创建的 run。

特征：

- 有 `runId`
- 有 `sessionKey`
- 有 lifecycle
- 不自动进入长期任务状态机

### Task

需要多轮推进、恢复、blocked/resume 的长期任务对象。

特征：

- 有 checkpoint
- 有 attempt budget
- 有 blocked / resume / done

## 本轮范围

### Phase 1：Run 骨架落地

目标：

- 为所有 agent 执行引入统一 `runId`
- 统一 run source / run status / startedAt / endedAt
- 普通消息、`/task`、heartbeat、schedule 全部进入 run 主链

建议文件：

- `src/runtime/` 下新增 run 类型与轻量 store
- `src/handlers.ts`
- `src/runtime/task-supervisor.ts`
- `src/commands.ts`
- `src/jobs/*`

硬验收：

1. 每次 agent 执行都有 `runId`
2. 日志里能明确看到 `runId + source + status`
3. 普通消息不再是“无主执行”

### Phase 2：Session Key 收口

目标：

- 把 `chatId/route/workspace` 显式映射到统一 `sessionKey`
- 为未来 Telegram/Discord 预留统一语义

硬验收：

1. 任何 run 都能追溯到稳定 `sessionKey`
2. `sessionKey` 不再只等于临时 chatId

### Phase 3：Context Policy 收口

目标：

- 将当前 `summary + window + checkpoint + tool preview + compact` 统一通过同一装配入口

硬验收：

1. 普通消息和 task 续跑使用同一套上下文装配器
2. `handlers.ts` 不再独占一套 compaction 主逻辑

### Phase 4：Run Events

目标：

- 抽统一事件层供未来 surface / CLI / mobile 消费

最小事件集：

- `run:start`
- `run:tool`
- `run:assistant`
- `run:block`
- `run:end`
- `run:error`

硬验收：

1. tool-loop 与 task 链输出同一组 run events
2. 不需要靠 grep 日志猜每轮运行发生了什么

### Phase 5：Benchmark

目标：

- 设计复杂任务 benchmark 并持续验证

建议 benchmark：

1. 多文件整理 + 汇总
2. 浏览器读取 + 文件输出 + 回执
3. 需要人工接力的 blocked/resume 任务
4. schedule 触发并持续推进的任务

硬验收：

1. 至少 3 类复杂任务能稳定完成或稳定 blocked
2. 不再只靠“感觉更稳了”

## 非范围 / 禁止扩 scope

- 不做 gateway
- 不做 WebSocket 控制面
- 不做手机客户端
- 不做 PWA
- 不做 Telegram/Discord 接入
- 不做新的 memory 平台
- 不做 manager-of-managers / planner tree

## 实现顺序

1. 先落 `run` 数据结构与日志口径
2. 再把普通消息链接入 run
3. 再把 `/task` / heartbeat / schedule 统一进 run
4. 再做 sessionKey 抽象
5. 再做 context policy 收口
6. 最后做 run events 与 benchmark

## 已知坑

1. `TaskSupervisor` 当前只覆盖显式 `/task`
2. `handlers.ts` 里 still 有独占 compaction 主逻辑
3. `summaryContext`、window、tool_result clip 还散在不同文件
4. `steering-queue` / lane queue / task queue 语义容易继续漂
5. 若一边做 Run Core 一边继续加旧补丁，会把主链越做越乱

## 交付格式

执行同学回传时必须包含：

- 任务
- 本轮只覆盖哪个 Phase
- 改动文件
- 验证命令
- 结果
- 风险 / 未覆盖项

## 派单正文（可直接转发）

```text
给执行同学：

任务：按 Phase 顺序把 Agent Core 收口成统一 Run Core，先从 Phase 1 开始，不要跨阶段大爆炸。

唯一真相源：
- Issue: /Users/admin/GitProjects/msgcode/issues/0066-openclaw-agent-core-gap-analysis.md
- Research: /Users/admin/GitProjects/msgcode/docs/notes/research-260310-openclaw-agent-core-gap.md
- Plan: /Users/admin/GitProjects/msgcode/docs/design/plan-260310-agent-core-gap-vs-openclaw.md
- Task: /Users/admin/GitProjects/msgcode/docs/tasks/p6-agent-core-run-core-dispatch-pack.md

本轮范围：
- 只做 Phase 1：Run 骨架落地
- 给所有 agent 执行引入统一 runId / source / status / startedAt / endedAt
- 普通消息、/task、heartbeat、schedule 都要进入 run 主链

非范围：
- 不做 gateway
- 不做 sessionKey 抽象
- 不做 WebSocket 控制面
- 不做 surface / mobile / PWA
- 不做 Telegram/Discord

硬要求：
- 简单聊天也必须有 runId
- 但简单聊天只创建 light run，不自动升级成 task
- run 不等于 task，不要把所有消息都塞进 TaskSupervisor
- 不允许新增厚控制层

实现顺序：
1. 先补 run 类型与最小持久化/日志
2. 再接普通消息链
3. 再接 /task / heartbeat / schedule
4. 最后补测试

硬验收：
1. 每次 agent 执行都有 runId
2. 日志里能看到 runId + source + status
3. 普通消息不再是无主执行
4. /task 仍保持原有长期任务语义，不被 run 抹平

已知坑：
- 当前 handlers.ts 里有独占 compaction 主逻辑
- TaskSupervisor 只覆盖显式 /task
- 不能一边做 Run Core 一边继续给旧链路打补丁

交付格式：
- 给验收同学：
  - 任务
  - 原因
  - 过程
  - 结果
  - 验证
  - 风险 / 卡点
  - 后续
```
