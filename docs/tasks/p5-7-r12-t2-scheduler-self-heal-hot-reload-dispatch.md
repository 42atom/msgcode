# 执行派单：P5.7-R12-T2（Scheduler 自愈与热加载）

派单对象：Opus  
优先级：P0  
执行模式：单任务隔离（仅执行 T2）

## 任务目标（必须同时满足）

1. 调度器在“无到期任务”场景下不中断（保活轮询）。  
2. `schedule enable/disable` 后无需手动 `/reload` 即生效。  
3. 调度异常后自动 re-arm，不进入静默停摆。

## 允许改动文件（白名单）

1. `/Users/admin/GitProjects/msgcode/src/jobs/scheduler.ts`
2. `/Users/admin/GitProjects/msgcode/src/routes/cmd-schedule.ts`
3. `/Users/admin/GitProjects/msgcode/src/config/schedules.ts`（仅当抽公共 helper 必需时）
4. `/Users/admin/GitProjects/msgcode/test/p5-7-r12-t2-scheduler-self-heal.test.ts`（新建）
5. `/Users/admin/GitProjects/msgcode/docs/tasks/p5-7-r12-t2-scheduler-self-heal-hot-reload.md`（回填完成状态）

超出白名单即停止并回报。

## 明确禁止（红线）

1. 不改 heartbeat runner 行为（T1 已冻结）。  
2. 不改 routed-chat/tool-loop/verify 链路（T3 范围）。  
3. 不改 steering queue 持久化（T4 范围）。  
4. 不改 CLI 合同字段与 help-docs 枚举。

## 实施步骤（每步一提交）

1. `fix(p5.7-r12-t2): keep scheduler alive in idle state`
   - 修复 `nextWakeAtMs === null` 时“暂停调度”逻辑，改为低频 idle poll。
   - 修复 `start()` 在空 store 场景下未 arm timer 的路径。

2. `feat(p5.7-r12-t2): auto-sync schedules on enable-disable`
   - `handleScheduleEnableCommand/DisableCommand` 成功后自动执行 schedule->jobs 同步。
   - 响应文案移除“请 /reload”依赖。

3. `test(p5.7-r12-t2): add scheduler self-heal and hot-reload locks`
   - 覆盖：idle 保活、enable/disable 自动生效、异常后 re-arm。
   - 全部行为断言，禁止源码字符串匹配。

## 验收门（硬门）

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`

## 验收证据模板（提交时必须按此格式）

1. 提交列表（按步骤）
2. 变更文件清单
3. 三门结果（tsc/test/docs）
4. 关键行为证据：
   - 无任务状态下调度器仍有 idle poll 证据
   - enable/disable 后 jobs 同步成功证据（无需 `/reload`）
   - 一次调度异常后仍继续下一轮 tick 的证据
5. 风险与未完成项（若无写“无阻塞项”）

## 交付口径

本单只签收 T2，不捎带 T3+ 变更。
若发现跨单问题，只记录，不在本单顺手修。

---

## Hotfix 历史记录

### Hotfix-1 ~ Hotfix-3（已合并）

略（见 git log）

### Hotfix-4（`9c62482`，未签收）

**问题**（用户评审 P1/P2）：
- P1: `kind:"at"` 任务过期后直接返回 null，未检查是否已执行过
- P2: 测试把"执行 0 次"定义为正确，固化了错误语义

**影响**：服务重启后，已到期但未执行的提醒会丢失

### Hotfix-5（`b5079fd`，待签收）

**修复**：
- `computeNextRunAtMs(kind:"at")`: 检查 `lastRunAtMs` 而非 `atMs <= nowMs`
  - 未执行过 → 返回 `atMs`（即使过期也补执行一次）
  - 已执行过 → 返回 `null`（不再重复）
- `computeNextWakeAtMs(kind:"at")`: 已执行过的 at 任务不参与调度
- 测试回归锁：断言过期未执行 at 任务执行 1 次，后续不重复

**三门结果**：
- `npx tsc --noEmit`: ✅ PASS
- `bun test test/p5-7-r12-t2-scheduler-self-heal.test.ts`: ✅ 9 pass / 0 fail
- `npm test`: ✅ 1395 pass / 0 fail
- `npm run docs:check`: ✅ PASS

**关键文件**：
- `src/jobs/cron.ts`: 修复 at 一次性语义
- `test/p5-7-r12-t2-scheduler-self-heal.test.ts`: 修正回归锁断言
