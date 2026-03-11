# 个人智能体架构审计（Unix 视角）

## 结论

当前 `msgcode` 最大的问题不是“功能不够多”，而是**为了控制和补救，引入了过多平行脚手架**。  
对一个“个人使用的本地智能体”来说，当前最违反 Unix 哲学的地方有 5 处：

1. 前置 route classifier 夺走了模型的工具决策权
2. fake-tool recover 是给错误主链打补丁
3. `task-supervisor` 变成了一条平行执行主链
4. `steering-queue` 同时承担队列、持久化、恢复、清理四种职责
5. `commands.ts` 继续承担运行时总控 God Object

## 1. 前置 route classifier 是多余脚手架

**证据**
- `src/agent-backend/routed-chat.ts`
  - `ROUTE_CLASSIFIER_SYSTEM_PROMPT`
  - `classifyRouteModelFirst()`
  - 主链一开始就调用分类器

**为什么违反 Unix**
- Unix 强调“一个部件做一件事”
- 这里的 router 本该只做分发/观测，却提前替模型做“要不要用工具”的判断
- 结果 router 变成了半个 agent

**对个人智能体的伤害**
- 模型明明已经拿到了工具说明书，却被前置分类器提前裁掉
- `no-tool` 不再是模型自己做出的选择，而是系统替它决定的

**应收口为**
- 用户消息直接进入主智能体
- 模型自己决定直答还是 `tool_calls`
- router 只保留：
  - 观测
  - 降级
  - 少量高置信 fallback

## 2. fake-tool recover 是补丁式复杂度

**证据**
- `src/agent-backend/routed-chat.ts`
  - `isLikelyFakeToolExecutionText()`
  - `no-tool response contained fake tool-call marker, rerouting to tool loop`

**为什么违反 Unix**
- 这不是清晰边界，而是“前面先判错，再靠后面猜回来”
- 等于主链不是单向数据流，而是：
  - 先走错
  - 再检测症状
  - 再回退补救

**对个人智能体的伤害**
- 测试时现象很绕
- 日志出现 `no-tool -> recover -> tool`
- 用户很难知道问题到底在 prompt、工具、还是路由

**应收口为**
- 去掉这类 recover 补丁
- 让首轮主智能体在完整工具上下文里直接决策

## 3. task-supervisor 正在变成平行主链

**证据**
- `src/runtime/task-supervisor.ts`
  - `executeTask()` 里直接 `import("../agent-backend/routed-chat.js")`
  - 然后自己驱动状态流转与预算检查

**为什么违反 Unix**
- 你已经有：
  - handlers
  - routed-chat
  - tool-loop
- `task-supervisor` 如果再直接调用 agent 主链，就会变成另一条“半独立执行入口”

**对个人智能体的伤害**
- 同一个任务语义，出现两套入口：
  - 用户聊天入口
  - task-supervisor 入口
- 后续极容易：
  - 一处修了，另一处漏掉
  - 一处日志有，另一处没有

**应收口为**
- `task-supervisor` 只负责：
  - 任务状态机
  - 调度
  - 预算
- 真正执行仍然走单一 agent 执行入口

## 4. steering-queue 同时做了太多事

**证据**
- `src/steering-queue.ts`
  - `initializeEventQueue()`
  - `getEventQueueStore()`
  - `getQueues()` 内部自动触发 `recoverEventsAsync()`
  - `push* / drain* / clear*` 又顺带做持久化和清理

**为什么违反 Unix**
- 一个队列模块本该只暴露简单语义：
  - push
  - consume
  - clear
- 现在它同时承担：
  - 内存缓存
  - 文件存储
  - 启动恢复
  - 状态迁移
  - 随机清理

**对个人智能体的伤害**
- 行为不透明
- `getQueues()` 这种看似纯读函数，内部却有异步恢复副作用
- 测试和排障都容易出现“为什么这次多了一条消息/少了一条消息”

**应收口为**
- 拆成两层：
  1. `queue API`
  2. `queue store`
- 恢复动作显式调用，不要藏在 `getQueues()` 里

## 5. commands.ts 仍然是运行时 God Object

**证据**
- `src/commands.ts`
  - 启动 `JobScheduler`
  - 启动 `HeartbeatRunner`
  - 初始化 `TaskSupervisor`
  - 初始化 `steering queue`
  - 接 iMessage / Feishu transport
  - 管理进程关闭与信号

**为什么违反 Unix**
- 它已经不是“启动入口”，而是“运行时总控面板”
- 一个文件知道太多系统细节，边界过厚

**对个人智能体的伤害**
- 任何运行时改动都容易回到这里堆逻辑
- 维护会越来越依赖“记忆这个文件里还顺手做了什么”

**应收口为**
- `commands.ts` 只做装配
- 把启动逻辑拆成：
  - runtime bootstrap
  - transport bootstrap
  - background services bootstrap

## 最小删减方案

### 必删

1. 前置 route classifier 主路径
2. fake-tool recover 补丁链

### 必降级

1. `task-supervisor`：降级为状态机/调度器，不再形成平行执行入口
2. `steering-queue`：降级为薄 API，恢复/存储拆出去

### 必拆薄

1. `commands.ts`：只保留装配，不继续叠业务

## 执行状态（2026-03-06）

### 必删 ✅

1. 前置 route classifier — 已删（`routed-chat.ts` 净删 122 行）
2. fake-tool recover 补丁链 — 已删（`isLikelyFakeToolExecutionText` 已从全链路清除）

### 必降级 ✅

1. `task-supervisor` — 已降级为注入式状态机（`executeTaskTurn` 通过构造函数注入）
2. `steering-queue` — `getQueues()` 退回纯内存读，恢复改为显式 `restoreQueuesFromDisk()`

### 必拆薄 ⏸️

1. `commands.ts` — 未拆，合理推迟（缺启动 smoke 兜底）

### 新增收口

- `executeAgentTurn()` 已成为唯一执行入口（`execute-turn.ts`）
- `handlers.ts`（981 行）已标记为后续拆薄对象

### 待收尾

- `commands.ts` 装配拆薄（需先补启动/停止 smoke）
- `lmstudio.ts` 兼容壳进一步瘦身（`parseToolCallBestEffortFromText` 去留待定）

## 一句话架构原则

对于“个人使用的本地智能体”，最符合 Unix 哲学的主链应该是：

**一个智能体 + 一套工具说明书 + 一条执行入口 + 一份状态真相源。**

而不是：

**一个智能体前面再套一层替它做主的路由器，后面再补一层恢复补丁，中间再并行长出一个任务监督器入口。**

## 当前现实

已实现：一个智能体 + 一套工具说明书 + **一条执行入口** + 一份状态真相源。  
待收尾：`commands.ts` 装配拆薄 + `lmstudio.ts` 兼容壳清理。
