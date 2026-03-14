# P5.6.10-R6：pi-mono 三包对照评审与落地参考

## 目的

对 `pi-mono` 的 `packages/ai`、`packages/agent`、`packages/coding-agent` 做结构化对照，提炼可直接借鉴的工程优点，并给出 `msgcode` 下一步的最小落地路线。

本评审聚焦“执行可信度、可维护性、扩展能力”，不做概念讨论。

## 阅读范围

- `pi-mono/packages/ai`
  - `/Users/admin/GitProjects/GithubDown/pi-mono/packages/ai/src/stream.ts`
  - `/Users/admin/GitProjects/GithubDown/pi-mono/packages/ai/src/api-registry.ts`
  - `/Users/admin/GitProjects/GithubDown/pi-mono/packages/ai/src/providers/transform-messages.ts`
  - `/Users/admin/GitProjects/GithubDown/pi-mono/packages/ai/src/utils/validation.ts`
- `pi-mono/packages/agent`
  - `/Users/admin/GitProjects/GithubDown/pi-mono/packages/agent/src/agent-loop.ts`
  - `/Users/admin/GitProjects/GithubDown/pi-mono/packages/agent/src/types.ts`
  - `/Users/admin/GitProjects/GithubDown/pi-mono/packages/agent/src/agent.ts`
- `pi-mono/packages/coding-agent`
  - `/Users/admin/GitProjects/GithubDown/pi-mono/packages/coding-agent/src/core/sdk.ts`
  - `/Users/admin/GitProjects/GithubDown/pi-mono/packages/coding-agent/src/core/agent-session.ts`
  - `/Users/admin/GitProjects/GithubDown/pi-mono/packages/coding-agent/src/core/tools/index.ts`
  - `/Users/admin/GitProjects/GithubDown/pi-mono/packages/coding-agent/src/core/tools/bash.ts`

## pi-mono 的核心优点（对我们最有价值）

### 1) 执行循环是“可证明正确”的

- `agent-loop` 把流程严格拆成：`消息注入 -> LLM -> tool calls -> tool results -> 下一轮`，每一步有显式事件。
- 支持 `steering/follow-up` 队列，且插入点明确，不会在工具中途出现不确定状态漂移。
- 工具执行生命周期有完整事件：`tool_execution_start/update/end`，前后文可追踪。

价值：运行时出现问题时，可以直接定位“模型问题/工具问题/编排问题”。

### 2) 协议适配层和业务层彻底分离

- `packages/ai` 用 `api-registry` 注册 provider，`stream/complete` 只依赖统一接口。
- provider 差异由 `transform-messages` 统一处理（toolCall id 归一、跨 provider 回放、孤儿 toolResult 补齐）。
- `EventStream` 是可复用底座：`push/end/result` 三件事，语义清晰。

价值：新增模型协议不污染上层业务，减少“一个 provider 修复牵动全链路”。

### 3) 工具调用契约硬约束

- 工具参数默认走 TypeBox + AJV 校验（`validateToolArguments`），错误会结构化抛出。
- coding-agent 的工具集由 `createCodingTools(cwd)` 构建，`cwd` 在工具创建时绑定，不在调用时漂移。

价值：把“工具调用失败”从运行时随机错误，变成可预测的契约错误。

### 4) 组合扩展优先，不走兼容壳

- `AgentSession` 作为单入口聚合会话、扩展、压缩、工具、模型切换，模式层只做 I/O。
- 工具集是注册表+工厂，扩展和替换都按同一机制走。

价值：扩展能力强，同时保持主链薄、可重构。

## 与 msgcode 的关键差距（当前阻塞）

### A. 执行根路径存在双真相源

- `lmstudio` 同时维护 `root` 与 `workspacePath`：
  - `/Users/admin/GitProjects/msgcode/src/lmstudio.ts:1232`
  - `/Users/admin/GitProjects/msgcode/src/lmstudio.ts:1236`
- 但工具执行走了 `root`：
  - `/Users/admin/GitProjects/msgcode/src/lmstudio.ts:1376`

结果：会出现“当前会话工作区是 A，但工具策略按 B 判定”的漂移。

### B. 工具失败后仍走二轮总结，导致假执行

- 工具失败时 `runTool` 返回 `{ error }`，但仍回灌第二轮让模型总结：
  - `/Users/admin/GitProjects/msgcode/src/lmstudio.ts:1374`
  - `/Users/admin/GitProjects/msgcode/src/lmstudio.ts:1400`

结果：模型可能输出“像执行过”的文本，和真实工具结果不一致。

### C. 工具类型源分裂，`shell/bash` 易回流

- `ToolName` 在两个位置定义且口径不一致：
  - `/Users/admin/GitProjects/msgcode/src/tools/types.ts:10`
  - `/Users/admin/GitProjects/msgcode/src/config/workspace.ts:80`

结果：编译能过但运行时出现命名漂移（历史上已出现 `SUCCESS shell` 日志）。

### D. Tool Bus 体量过大，职责耦合

- `/Users/admin/GitProjects/msgcode/src/tools/bus.ts` 当前约 1063 行（策略、执行、会话池、遥测混在一起）。

结果：改一个工具行为，回归面过大，冲突概率高。

## 直接可借鉴的实现清单（按优先级）

### P0：立即借鉴（本周）

1. **单一执行上下文**
   - 引入 `ExecutionContext`（`workspacePath/requestId/source`）为唯一入口。
   - ToolLoop 全链路只传一个 `workspacePath`，禁止 `root` 二义性。
2. **失败短路策略**
   - 工具返回 `error` 时直接向用户回结构化失败，不再进行二轮自然语言总结。
3. **工具类型单源**
   - 只保留一份 `ToolName` 类型，其他模块引用该定义，禁止重复声明。

### P1：高收益借鉴（下周）

1. **参数校验层**
   - 给四核心工具（`read_file/write_file/edit_file/bash`）补 TypeBox + AJV 校验。
2. **工具工厂绑定 cwd**
   - 增加 `createCoreTools(workspacePath)`，工具初始化即绑定工作区。

### P2：中期借鉴（P5.6.10 内）

1. **EventStream 化**
   - 将 `lmstudio tool loop` 输出改为结构化流事件（start/tool_call/tool_result/end）。
2. **Tool Bus 分层**
   - 拆成 `policy` / `runners` / `session-pool` / `telemetry`，`bus` 只做路由编排。

## 建议落地顺序（与主线对齐）

1. `P5.6.8-R4h`：先修执行正确性（root 单真相 + 失败防幻想 + 命名收口）
2. `P5.6.10-R1~R4`：再做 Tool Bus 解耦与可观测硬化
3. `P5.6.10-R5`：三工作区运行时终验
4. `P5.6.10-R6`（本单）：形成长期对照基线，避免后续回滚式漂移

## 决策结论

- 不建议“整包移植” `pi-mono`，因为 msgcode 有 direct/tmux 双管道与既有命令面约束。
- 建议“移植机制，不移植外形”：
  - 移植执行契约（单上下文、失败短路、参数校验、事件流）
  - 保留 msgcode 的业务边界（SOUL/记忆/路由面）

这条路改动最小、收益最大，并且能直接解决当前 `bash` 失败与假执行问题。

