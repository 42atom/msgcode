# 任务单：P5.7-R12-T4（事件队列持久化与重启恢复）

优先级：P0

## 回链

- Issue: [0006](../../issues/0006-agent-relentless-task-closure.md)
- Plan: docs/design/plan-260306-agent-relentless-task-closure.md

## 目标（冻结）

1. 把关键事件队列从内存态升级为可恢复持久化。  
2. 重启后可恢复未处理事件，保证不中断。  
3. 事件状态可追踪（`queued -> processing -> done|failed`）。

## 可行性依据（代码现状）

1. `src/steering-queue.ts` 已是独立模块，易替换存储实现。  
2. 当前注释明确“in-memory, no persistence”，是可定位单点。  
3. `src/commands.ts` 已有统一生命周期入口，可接启动恢复。

## 范围（冻结）

涉及文件（预期）：

1. `/Users/admin/GitProjects/msgcode/src/steering-queue.ts`
2. `/Users/admin/GitProjects/msgcode/src/runtime/event-queue-store.ts`（新建）
3. `/Users/admin/GitProjects/msgcode/src/commands.ts`
4. `/Users/admin/GitProjects/msgcode/test/p5-7-r12-t4-event-queue-persistence.test.ts`（新建）

## 范围外（冻结）

1. 不在本单引入外部 MQ/Redis。  
2. 不扩展新的命令面 API。  
3. 不在本单重写 tool loop 调度器。

## 设计约束（冻结）

1. 存储格式：JSONL（File-First，便于排障与审计）。  
2. 每条事件必须包含：`eventId`、`chatId`、`kind`、`payload`、`traceId`、`status`、`createdAt`。  
3. 支持幂等去重（同 chat + 同 digest 在窗口期内只入队一次）。

## 实施步骤（每步一提交）

1. `feat(p5.7-r12-t4): add persistent event queue store (jsonl)`
   - 新增读写与状态迁移 API
2. `refactor(p5.7-r12-t4): switch steering-queue to persistent backend`
   - 保持 `push/drain/consume` 现有函数签名
   - 增加恢复扫描入口
3. `feat(p5.7-r12-t4): recover pending events on startup`
   - 启动时加载 `queued|processing` 事件
   - 交由 heartbeat/主循环继续处理
4. `test(p5.7-r12-t4): add queue persistence and replay locks`
   - 重启恢复锁
   - 状态流转锁
   - 去重锁

## 验收门（冻结）

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`
4. 真实证据：
   - 注入事件后重启，事件仍可被处理
   - 事件状态流转可从队列文件回放

## 依赖关系

1. 前置：R12-T1（heartbeat 唤醒底座）  
2. 后置：R12-T6 preflight 可增加队列健康项

## 风险与缓解

1. 风险：JSONL 膨胀导致读放大  
   缓解：加入快照/压缩策略（按条数或天数滚动）。  
2. 风险：并发写入冲突  
   缓解：采用串行 append + 原子 rename 的写策略。
