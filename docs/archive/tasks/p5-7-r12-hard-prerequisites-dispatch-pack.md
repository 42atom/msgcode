# 任务单：P5.7-R12（硬前提补齐派单包）

优先级：P0（连续运行与可验证交付的基础门槛）

## 背景

当前主链已完成多轮能力扩展，但要达到“可长期连续工作”的状态，仍缺 7 个硬前提：

1. 常驻唤醒主循环（heartbeat/event wake）
2. 调度器自愈与热加载
3. `verify` 阶段进入主链（`plan -> act -> verify -> report`）
4. 事件队列持久化（替代内存态关键队列）
5. 多模型上下文预算统一
6. Secrets 单源与 preflight 闭环
7. 模型服务生命周期治理（空闲释放与复用）

本单目标是按顺序补齐以上硬前提，形成稳定可持续运行底座。

## 执行顺序（冻结）

1. `R12-T1`：常驻唤醒主循环（Heartbeat + Event Wake）
2. `R12-T2`：调度器自愈与热加载
3. `R12-T3`：`verify` 阶段入主链
4. `R12-T4`：事件队列持久化
5. `R12-T5`：上下文预算统一（动态探测优先 + 表兜底）
6. `R12-T6`：Secrets 单源与 preflight 闭环
7. `R12-T7`：Whisper/本地模型服务空闲 10 分钟释放

禁止并行跨单改动：前一单 Gate 通过后，才能进入下一单。

## 子单索引（可直接派发）

1. `/Users/admin/GitProjects/msgcode/docs/tasks/p5-7-r12-t1-heartbeat-event-wake.md`
2. `/Users/admin/GitProjects/msgcode/docs/tasks/p5-7-r12-t2-scheduler-self-heal-hot-reload.md`
3. `/Users/admin/GitProjects/msgcode/docs/tasks/p5-7-r12-t3-verify-phase-mainline.md`
4. `/Users/admin/GitProjects/msgcode/docs/tasks/p5-7-r12-t4-event-queue-persistence.md`
5. `/Users/admin/GitProjects/msgcode/docs/tasks/p5-7-r12-t5-context-budget-single-source.md`
6. `/Users/admin/GitProjects/msgcode/docs/tasks/p5-7-r12-t6-secrets-single-source-preflight.md`
7. `/Users/admin/GitProjects/msgcode/docs/tasks/p5-7-r12-t7-model-service-idle-release.md`

## 关联依赖图（冻结）

```text
R12-T1 -> R12-T2 -> R12-T3 -> R12-T5 -> R12-T6 -> R12-T7
    └-----------------------> R12-T4
```

解释：
1. `T1` 先落唤醒底座，`T2/T4` 共用该基础。  
2. `T2` 保证调度稳定后，再在 `T3` 引入 verify，不会被“调度停摆”干扰验收。  
3. `T4` 依赖 `T1` 但可与 `T3` 相邻执行；冻结顺序仍按主线执行避免并发冲突。  
4. `T5/T6` 是运行期一致性收口，放在行为主链稳定之后执行。  
5. `T7` 在 secrets 与预算口径稳定后执行，便于将“空闲释放”问题与“鉴权/预算”问题隔离定位。

## 子单定义

### R12-T1：Heartbeat + Event Wake

目标：
1. 无新消息时也能周期唤醒 Agent。
2. 唤醒日志可观测（心跳、跳过、失败重试）。

核心变更（预期）：
1. `src/commands.ts`：`startBot` 接入心跳启动。
2. `src/runtime/`：新增 heartbeat runner（或独立模块）。
3. `test/`：新增心跳运行/重启恢复行为锁。

验收：
1. 静置 30 分钟仍可看到 heartbeat tick。
2. 心跳可拉起待处理任务。
3. 进程重启后可自动恢复心跳。

### R12-T2：调度器自愈 + 热加载

目标：
1. 不再依赖手动 `/reload` 才让 schedule 生效。
2. 无到期任务时保持低频保活，避免“停摆”。

核心变更（预期）：
1. `src/jobs/scheduler.ts`：re-arm/self-heal。
2. `src/routes/cmd-schedule.ts`：写入后触发热重载路径。
3. `test/`：新增 schedule 变更即时生效锁。

验收：
1. 新增/删除 schedule 后 60 秒内生效。
2. 无到期任务状态下调度器不中断。
3. 异常后能自动恢复定时器。

### R12-T3：`verify` 阶段入主链

目标：
1. 主链从三阶段升级为四阶段：`plan -> act -> verify -> report`。
2. 强化“Verify before deliver”，避免未校验即回包。

核心变更（预期）：
1. `src/agent-backend/routed-chat.ts`：新增 `verify` phase。
2. `src/agent-backend/tool-loop.ts`：提供可复核执行证据。
3. `test/`：新增 verify 阶段日志与失败分支锁。

验收：
1. 文件/命令类任务必须有 verify 证据。
2. verify 失败时不得返回“已完成”。
3. phase 日志顺序固定可断言。

### R12-T4：事件队列持久化

目标：
1. 关键事件不再只存在内存。
2. 重启后可恢复未处理事件。

核心变更（预期）：
1. `src/steering-queue.ts`：从内存队列升级为持久化队列。
2. `src/runtime/`：启动恢复扫描逻辑。
3. `test/`：重启恢复、去重、状态流转锁。

落地建议：
1. 首选 JSONL 文件队列（符合 File-First）。
2. 每条事件必须包含 `traceId`、`status`、`createdAt`。

验收：
1. 重启后未完成事件继续执行。
2. 重复事件按幂等键去重。
3. 队列状态迁移可追溯。

### R12-T5：上下文预算统一

目标：
1. 不同后端模型窗口下都能稳定续聊。
2. 预算计算口径统一，避免不同路径漂移。

核心变更（预期）：
1. 运行时能力探测优先。
2. 模型最大上下文表作为兜底覆盖。
3. token 估算器统一到单点模块。

验收：
1. `agent-backend/local-openai/minimax/gemini` 切换后预算字段正确。
2. 保持 `70% compact` + `85% hard guard`。
3. 长对话连续测试不过窗。

### R12-T6：Secrets 单源 + Preflight 闭环

目标：
1. 切后端不再因配置键分裂失败。
2. preflight 能直接给可执行修复建议。

核心变更（预期）：
1. 统一密钥读取优先级（`Keychain > env`）。
2. 统一后端基础配置键（base URL/model/api key）。
3. `preflight` 报告输出“缺失项 + 修复命令”。

验收：
1. 切换后端后一键通过 preflight。
2. 错误提示可直接执行修复。
3. 无重复/冲突配置键定义。

### R12-T7：模型服务生命周期（10 分钟空闲释放）

目标：
1. 验证 Whisper 与其他本地模型服务是否出现异常常驻。
2. 建立统一策略：最后一次使用后保活 10 分钟，再自动释放。

核心变更（预期）：
1. `src/runtime/model-service-lease.ts`：新增统一 lease 管理（touch/use/release）。
2. `src/runners/asr.ts`、`src/media/pipeline.ts`、`src/agent-backend/chat.ts`：接入生命周期管理。
3. `test/`：新增保活窗口、超时释放、in-flight 保护行为锁。

验收：
1. 10 分钟内复用命中（无额外冷启动）。
2. 超过 10 分钟空闲后自动释放，再次请求可恢复冷启动。
3. 执行中任务不会被空闲策略误回收。

## 统一硬验收（每个子单必须满足）

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`
4. 至少 1 条真实成功证据 + 1 条真实失败证据（错误码固定可断言）
5. 无新增 `.only/.skip`
6. 行为断言优先，禁止源码字符串脆弱锁

## 提交纪律（冻结）

1. 禁止 `git add -A`
2. 每步隔离提交；每提交只包含当前子单必要文件
3. 发现非本单改动，暂停并上报
4. 每个子单提交后必须附“证据块”（提交列表、变更文件、三门结果、关键行为证据、风险清单）

## 备注

本单编号为 `R12`，用于避免与既有 `P5.7-R10-1/2/3` 可用性子单混淆。
