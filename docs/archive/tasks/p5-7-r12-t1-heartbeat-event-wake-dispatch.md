# 执行派单：P5.7-R12-T1（Heartbeat 常驻唤醒与事件唤醒底座）

派单对象：Opus  
优先级：P0  
执行模式：单任务隔离（只做 T1，不并发 T2~T6）

## 任务目标（必须同时满足）

1. 在无新消息场景下保持周期唤醒（heartbeat tick）。  
2. `startBot` 启动 heartbeat，`stopBot` 停止 heartbeat。  
3. 心跳失败不致停摆（自恢复）。

## 允许改动文件（白名单）

1. `/Users/admin/GitProjects/msgcode/src/runtime/heartbeat.ts`（新建）
2. `/Users/admin/GitProjects/msgcode/src/commands.ts`
3. `/Users/admin/GitProjects/msgcode/test/p5-7-r12-t1-heartbeat-event-wake.test.ts`（新建）
4. `/Users/admin/GitProjects/msgcode/docs/tasks/p5-7-r12-t1-heartbeat-event-wake.md`（回填完成状态）

超出白名单即停止并回报。

## 明确禁止（红线）

1. 不修改 `scheduler` 行为（T2 范围）。  
2. 不修改 `tool-loop/routed-chat`（T3 范围）。  
3. 不修改 `steering-queue` 存储实现（T4 范围）。  
4. 不改任何命令合同与 help-docs 枚举。

## 实施步骤（每步一提交）

1. `feat(p5.7-r12-t1): add heartbeat runner module`
   - 新建 heartbeat runner，暴露：`start()` / `stop()` / `triggerNow(reason)`。
   - 支持 interval 配置（默认 60s，环境变量可覆盖）。
   - 防重入：上次 tick 未完成时本轮跳过并记录。

2. `feat(p5.7-r12-t1): wire heartbeat lifecycle into start-stop flow`
   - `startBot()` 初始化并启动 heartbeat。
   - `stopBot()` 显式停止 heartbeat。
   - 日志字段固定：`tickId`、`reason`、`durationMs`、`ok`。

3. `test(p5.7-r12-t1): add heartbeat event-wake regression locks`
   - 覆盖：启动、停止、防重入、异常自恢复、手动 trigger。
   - 仅行为断言，禁止源码字符串匹配。

## 验收门（硬门）

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`

## 验收证据模板（提交时必须按此格式）

1. 提交列表（按步骤）  
2. 变更文件清单  
3. 三门结果（tsc/test/docs）  
4. 关键行为证据：
   - 心跳日志样例（至少 2 次 tick）
   - 异常后仍继续 tick 的证据
   - stop 后不再 tick 的证据  
5. 风险与未完成项（若无则写“无阻塞项”）

## 交付口径

完成后仅汇报 T1，不捎带 T2/T3 改动。  
若发现跨单问题，记录到备注，不在本单顺手修。
