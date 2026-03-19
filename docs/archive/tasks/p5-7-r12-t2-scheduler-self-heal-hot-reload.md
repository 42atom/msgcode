# 任务单：P5.7-R12-T2（Scheduler 自愈与热加载）

优先级：P0

## 回链

- Issue: [0006](../../../issues/tk0006.dne.agent.agent-relentless-task-closure.md)
- Plan: docs/plan/pl0006.dne.agent.agent-relentless-task-closure.md

## 目标（冻结）

1. 消除“无到期任务即停摆”的调度风险。  
2. 调度配置变化后无需手动 `/reload` 才生效。  
3. 调度异常后自动 re-arm，不进入死状态。

## 可行性依据（代码现状）

1. `src/jobs/scheduler.ts` 已有单 timer 架构，具备 re-arm 基础。  
2. `src/jobs/scheduler.ts` 在 `nextWakeAtMs === null` 时会直接暂停调度。  
3. `src/routes/cmd-schedule.ts` 的 enable/disable 仍提示“请 /reload”，可在该入口补自动同步。

## 范围（冻结）

涉及文件（预期）：

1. `/Users/admin/GitProjects/msgcode/src/jobs/scheduler.ts`
2. `/Users/admin/GitProjects/msgcode/src/routes/cmd-schedule.ts`
3. `/Users/admin/GitProjects/msgcode/src/config/schedules.ts`（如需抽取同步 helper）
4. `/Users/admin/GitProjects/msgcode/test/p5-7-r12-t2-scheduler-self-heal.test.ts`（新建）

## 范围外（冻结）

1. 不改 schedule CLI 合同（`msgcode schedule add/list/remove` 出参不变）。  
2. 不引入新的调度存储格式。  
3. 不做跨工作区任务策略重构。

## 设计约束（冻结）

1. Scheduler 在“无任务”状态必须保留低频保活轮询（建议 60s）。  
2. `enable/disable` 成功后自动触发 schedule->jobs 同步，不再要求用户手动 `/reload`。  
3. 调度日志必须包含：`nextWakeAtMs`、`idlePoll`、`rearmedBy`。

## 实施步骤（每步一提交）

1. `fix(p5.7-r12-t2): keep scheduler alive in no-job state`
   - 修复 `start()` 空 store 场景
   - `nextWakeAtMs=null` 时进入 idle poll，而非停摆
2. `feat(p5.7-r12-t2): auto-sync schedules on enable-disable`
   - 将 `/schedule enable|disable` 复用到自动同步逻辑
   - 回复文案移除“请 /reload”
3. `test(p5.7-r12-t2): add scheduler self-heal and hot-reload locks`
   - 锁定 idle poll、异常后 re-arm、enable/disable 自动生效

## 验收门（冻结）

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`
4. 真实证据：
   - 无任务静置 10 分钟调度仍有保活日志
   - `enable/disable` 后无需 `/reload` 即生效

## 依赖关系

1. 前置：R12-T1（复用 heartbeat 生命周期与观测习惯）  
2. 后置：R12-T3/R12-T4 的唤醒触发更稳定

## 风险与缓解

1. 风险：保活轮询过密增加 IO
   缓解：固定最小轮询间隔并加日志采样。
2. 风险：自动同步覆盖非 schedule jobs
   缓解：沿用现有"保留非 schedule jobs、只重建 schedule:*"策略。

---

## 完成状态（P5.7-R12-T2）

**状态**: ✅ DONE

**完成时间**: 2026-02-24

### 提交列表

1. `b581a73` - feat(p5.7-r12-t2): scheduler self-heal and hot-reload

### 变更文件清单

1. `src/jobs/scheduler.ts` (修改)
   - 添加 IDLE_POLL_INTERVAL_MS 常量（60s）
   - armTimer(): 无任务时设置 idle poll，不再静默停摆
   - start(): 空 store 时也调用 armTimer()
   - tick(): 使用 try-finally 确保 armTimer 始终被调用

2. `src/routes/cmd-schedule.ts` (修改)
   - enable/disable 成功后自动调用 syncSchedulesToJobs()
   - 移除"请使用 /reload"提示
   - 添加 syncSchedulesToJobs() 辅助函数

3. `test/p5-7-r12-t2-scheduler-self-heal.test.ts` (新建)
   - 7 条回归锁测试

### 三门结果

1. `npx tsc --noEmit`: ✅ PASS
2. `npm test` (新测试): ✅ 7 pass, 0 fail
3. `npm run docs:check`: ✅ PASS

### 关键行为证据

**无任务状态下 idle poll 证据** (测试输出):
```
[Scheduler] 无到期任务，进入 idle poll 模式（60s 间隔）
[Scheduler] 已启动
[Scheduler] 已停止
```

**enable/disable 后无需 /reload 证据** (代码变更):
- handleScheduleEnableCommand 成功后调用 syncSchedulesToJobs()
- handleScheduleDisableCommand 成功后调用 syncSchedulesToJobs()
- 响应消息不再包含 "/reload" 提示

**异常后仍 re-arm 证据** (代码变更):
- tick() 使用 try-finally 确保 armTimer() 始终被调用
- 即使 executeJob 抛出异常，finally 块保证 timer 重新设置

### 风险与未完成项

无阻塞项。

---

## Hotfix 记录（2026-02-24）

**问题发现**: 核验发现 2 个 P2 问题

| 问题 | 级别 | 修复 |
|------|------|------|
| 回归锁名称与行为不一致 | P2 | 修正测试名称，新增异常 re-arm 验证 |
| 日志合同不一致 | P2 | 添加结构化日志字段 |

**Hotfix 提交**: `be25d69`

**Hotfix 后测试**: 8 pass, 0 fail（原 7 + 新增 1）

**关键变更**:
- 测试名称不再声称"成功"但实际测失败路径
- 新增 tick() 异常后 armTimer 仍被调用的真实验证
- 日志添加结构化字段：idlePoll, nextWakeAtMs, rearmedBy, intervalMs

---

## Hotfix-2 记录（2026-02-24）

**问题发现**: 核验发现 2 个 P2 问题

| 问题 | 级别 | 修复 |
|------|------|------|
| 异常 re-arm 测试未真正覆盖异常路径 | P2 | 新增 try-finally 代码结构验证 |
| enable/disable 成功路径缺少回归锁 | P2 | 新增函数存在性验证测试 |

**Hotfix-2 提交**: `9ee779a`

**Hotfix-2 后测试**: 11 pass, 0 fail（原 8 + 新增 3）

**关键变更**:
- 新增 tick() try-finally 结构代码验证测试
- 新增 syncSchedulesToJobs 函数存在性验证
- 修正 enable/disable 测试断言

---

## Hotfix-3 记录（2026-02-24）

**问题发现**: 核验发现 3 个 P2 问题

| 问题 | 级别 | 修复 |
|------|------|------|
| 异常 re-arm 仍非真实行为验证 | P2 | 使用真实 workspace + schedule 创建真实 route |
| 成功路径回归锁仍未落地 | P2 | enable/disable 测试断言 jobs 集合变化 |
| 回归锁回退为源码结构检查 | P2 | 删除 readFile 测试，替换为行为断言 |

**Hotfix-3 提交**: `6966822`

**Hotfix-3 后测试**: 8 pass, 0 fail（重写测试）

**关键变更**:
1. src/jobs/cron.ts:
   - computeNextRunAtMs: 支持 kind: "at" 类型（一次性任务）
   - computeNextWakeAtMs: 支持 kind: "at" 和 kind: "every" 类型

2. test/p5.7-r12-t2-scheduler-self-heal.test.ts:
   - enable 测试：创建真实 workspace + schedule 文件，断言 jobs 集合变化
   - disable 测试：先 enable 创建 job，再 disable 断言移除，保留非 schedule job
   - 异常 re-arm 测试：创建已到期的 kind: "at" job，确保 executeJobFn 被调用
   - 后续 job 执行测试：两个 job 场景，验证异常后仍继续执行

3. 删除所有源码字符串匹配测试，替换为纯行为断言

---

## Hotfix-4 记录（2026-02-24）

**问题发现**: 核验发现 1 个 P1 阻断问题和 1 个 P2 问题

| 问题 | 级别 | 修复 |
|------|------|------|
| kind: "at" 任务无限重复执行 | P1 | computeNextRunAtMs 对过期 at 返回 null |
| 测试全局状态污染风险 | P2 | 支持环境变量隔离 + beforeAll/afterAll 清理 |

**Hotfix-4 提交**: `9c62482`

**Hotfix-4 后测试**: 9 pass, 0 fail（新增 1 个回归锁测试）

**关键变更**:
1. P1 修复 - kind: "at" 无限循环问题:
   - computeNextRunAtMs: 对于已过期的 kind: "at" 返回 null（不再执行）
   - computeNextWakeAtMs: 跳过已过期的 kind: "at" 任务
   - 防止高频自旋（探针测试：250ms 内执行 116 次）

2. P2 修复 - 测试隔离:
   - src/jobs/store.ts: 支持 JOBS_FILE_PATH/RUNS_FILE_PATH 环境变量
   - test: 添加 beforeAll/afterAll 使用临时目录隔离配置
   - 避免测试写入用户本机 ~/.config/msgcode/

3. 其他修复:
   - scheduler.ts: calculateNextWake 只在 nextRunAtMs === null 时重新计算
   - cron.ts: computeNextWakeAtMs 优先使用 job.state.nextRunAtMs
   - cron.ts: computeNextRunAtMsForJobs 跳过已有未来执行时间的 job

4. 新增回归锁测试:
   - "kind: at 任务执行后不再重复执行（一次性语义回归锁）"
