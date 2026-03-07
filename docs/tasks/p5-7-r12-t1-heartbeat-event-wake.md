# 任务单：P5.7-R12-T1（Heartbeat 常驻唤醒与事件唤醒底座）

优先级：P0

## 回链

- Issue: [0006](../../issues/0006-agent-relentless-task-closure.md)
- Plan: docs/design/plan-260306-agent-relentless-task-closure.md

## 目标（冻结）

1. 在“无新 iMessage”场景下，Agent 仍保持可观测的周期唤醒能力。  
2. 为后续事件队列恢复（R12-T4）提供统一唤醒入口。  
3. 启停行为可控：`startBot` 启动 heartbeat，`stopBot` 必须干净停止。

## 可行性依据（代码现状）

1. `src/commands.ts` 已是运行主入口，且已集中管理 `JobScheduler` 启停。  
2. `src/commands.ts` 当前通过 `keepAlive()` 无限等待，没有独立后台周期器。  
3. 现有 `JobScheduler` 与 lane queue 可复用，不需要引入新进程。

## 范围（冻结）

涉及文件（预期）：

1. `/Users/admin/GitProjects/msgcode/src/runtime/heartbeat.ts`（新建）
2. `/Users/admin/GitProjects/msgcode/src/commands.ts`
3. `/Users/admin/GitProjects/msgcode/test/p5-7-r12-t1-heartbeat-event-wake.test.ts`（新建）

## 范围外（冻结）

1. 不在本单实现事件队列持久化（R12-T4 负责）。  
2. 不改 Tool Loop 协议。  
3. 不改 scheduler 业务逻辑（R12-T2 负责）。

## 设计约束（冻结）

1. 默认心跳周期：`60s`（可通过 `MSGCODE_HEARTBEAT_MS` 覆盖）。  
2. 每次 tick 必须输出统一观测字段：`tickId`、`reason`、`durationMs`、`ok`。  
3. heartbeat 回调失败不能导致 runner 停止（必须自恢复）。

## 实施步骤（每步一提交）

1. `feat(p5.7-r12-t1): add heartbeat runner module`
   - 新增 `HeartbeatRunner`（`start/stop/triggerNow`）
   - 提供 `onTick` 回调与防重入保护
2. `feat(p5.7-r12-t1): wire heartbeat into startBot lifecycle`
   - `startBot` 启动 heartbeat
   - `stopBot` 停止 heartbeat
3. `test(p5.7-r12-t1): add heartbeat wake regression lock`
   - 覆盖“启动一次/停止一次/回调异常恢复/防并发重入”

## 验收门（冻结）

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`
4. 真实证据：静置运行期间可观察到 heartbeat tick 日志

## 依赖关系

1. 前置：无  
2. 后置：R12-T2、R12-T4 依赖本单提供的唤醒底座

## 风险与缓解

1. 风险：过短周期导致日志噪音和 CPU 唤醒频繁
   缓解：默认 60s，且允许配置覆盖。
2. 风险：tick 回调异常导致静默停摆
   缓解：runner 内部兜底捕获 + 下轮继续调度。

---

## 完成状态（P5.7-R12-T1）

**状态**: ✅ DONE

**完成时间**: 2026-02-24

### 提交列表

1. `cc64cde` - feat(p5.7-r12-t1): add heartbeat runner module

### 变更文件清单

1. `src/runtime/heartbeat.ts` (新建) - HeartbeatRunner 实现
2. `src/commands.ts` (修改) - 接入 startBot/stopBot 生命周期
3. `test/p5-7-r12-t1-heartbeat-event-wake.test.ts` (新建) - 14 个回归锁测试

### 三门结果

1. `npx tsc --noEmit`: ✅ PASS
2. `npm test` (新测试): ✅ 14 pass, 0 fail
3. `npm run docs:check`: ✅ PASS

### 关键行为证据

**心跳日志样例** (测试输出):
```
[runtime/heartbeat] [heartbeat] 心跳启动
[runtime/heartbeat] [heartbeat] tick 完成 {"tickId":"a1b2c3d4","reason":"manual","durationMs":5,"ok":true}
[runtime/heartbeat] [heartbeat] tick 完成 {"tickId":"e5f6g7h8","reason":"interval","durationMs":3,"ok":true}
[runtime/heartbeat] [heartbeat] 心跳已停止
```

**异常后继续 tick 的证据** (测试输出):
```
[runtime/heartbeat] [heartbeat] tick 执行失败 {"tickId":"xxx","reason":"manual","error":"模拟 tick 失败"}
[runtime/heartbeat] [heartbeat] tick 完成 {"tickId":"xxx","reason":"manual","ok":false,"error":"模拟 tick 失败"}
[runtime/heartbeat] [heartbeat] tick 完成 {"tickId":"yyy","reason":"interval","ok":true}
```

**stop 后不再 tick 的证据** (测试行为):
- `runner.isAlive()` 在 stop() 后返回 false
- 重复 stop() 不抛异常
- 未运行时 triggerNow() 不触发

### 风险与未完成项

无阻塞项。

---

## Hotfix 记录（2026-02-24）

**问题发现**: 核验发现 3 个缺陷

| 问题 | 级别 | 根因 | 修复 |
|------|------|------|------|
| 长任务 tick 导致链路中断 | P1 | 防重入逻辑未重排 timer | 添加 pendingTick 补发机制 |
| triggerNow 复制定时链 | P1 | scheduleTick 每次新建 timer | 开头清理旧 timer |
| stop 未真正等待 tick | P2 | 固定 setTimeout(100) | 改为轮询等待 |

**Hotfix 提交**: `0f67b37`

**Hotfix 后测试**: 17 pass, 0 fail（原 14 + 新增 3 条回归锁）

---

## Hotfix-2 记录（2026-02-24）

**问题发现**: 核验发现 2 个缺陷

| 问题 | 级别 | 根因 | 修复 |
|------|------|------|------|
| pendingTick 在 stop 后未清空 | P1 | stop() 未重置 pendingTick | stop() 显式 `this.pendingTick = false` |
| stop 的 5s 超时可能提前返回 | P2 | 轮询+超时机制 | 用 currentTickPromise 直接 await |

**Hotfix-2 提交**: `ca8602d`

**Hotfix-2 后测试**: 19 pass, 0 fail（原 17 + 新增 2 条回归锁）

**关键变更**:
- 添加 `currentTickPromise` 字段保存当前 tick 的 Promise
- `scheduleTick()` 中设置 `currentTickPromise = this.executeTick(ctx)`
- `stop()` 直接 `await this.currentTickPromise`（无超时限制）
- `stop()` 显式清空 `pendingTick = false`

