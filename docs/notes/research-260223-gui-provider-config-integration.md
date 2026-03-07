# research-260223-gui-provider-config-integration

## 范围

本研究只讨论 `GUI 整合` 的第一阶段：`供应商（provider）配置系统`。

边界：
- 包含：配置模型、密钥存储、运行态管理、GUI 编辑/测试流。
- 不包含：完整 App IA 重构、技能市场、节点互联、商业化设计。

非目标：
- 本文不直接改动现有运行链路。
- 本文不一次性替换现有 `.env` 与 `/model` 行为。

## 受影响模块

1. `msgcode` 现状模块
- `/Users/admin/GitProjects/msgcode/src/config/workspace.ts`
- `/Users/admin/GitProjects/msgcode/src/config.ts`
- `/Users/admin/GitProjects/msgcode/src/routes/cmd-model.ts`
- `/Users/admin/GitProjects/msgcode/src/handlers.ts`
- `/Users/admin/GitProjects/msgcode/src/agent-backend/config.ts`

2. `osaurus` 参考模块
- `/Users/admin/GitProjects/GithubDown/osaurus/Packages/OsaurusCore/Models/RemoteProviderConfiguration.swift`
- `/Users/admin/GitProjects/GithubDown/osaurus/Packages/OsaurusCore/Services/RemoteProviderKeychain.swift`
- `/Users/admin/GitProjects/GithubDown/osaurus/Packages/OsaurusCore/Services/RemoteProviderManager.swift`
- `/Users/admin/GitProjects/GithubDown/osaurus/Packages/OsaurusCore/Views/RemoteProvidersView.swift`
- `/Users/admin/GitProjects/GithubDown/osaurus/Packages/OsaurusCore/Views/Components/RemoteProviderEditSheet.swift`

## 现状核验（msgcode）

1. provider 选择是“全局 env 优先”，不是项目域单源
- `/model` 在命令侧直接写 `~/.config/msgcode/.env` 的 `AGENT_BACKEND`。见 `/Users/admin/GitProjects/msgcode/src/routes/cmd-model.ts`
- 执行侧通过 `process.env.AGENT_BACKEND` 解析 provider。见 `/Users/admin/GitProjects/msgcode/src/handlers.ts`
- 结果：群聊绑定 workspace 后，provider 仍主要受全局环境影响，和“项目域生效”目标不一致。

2. 密钥与普通配置混合在 `.env`
- 例如 `LMSTUDIO_API_KEY`、`OPENAI_API_KEY`、`MINIMAX_API_KEY` 都在进程环境解析。见 `/Users/admin/GitProjects/msgcode/src/agent-backend/config.ts`
- 没有 Keychain 层，也没有 provider 级 secret 生命周期管理。

3. 运行态没有 provider manager 层
- 当前有 provider 解析和请求发送，但缺少“连接/重连/状态/模型发现”的统一管理器。
- UI 无法直接展示 `connecting/connected/error/modelCount` 这类状态。

4. 文档与实现有轻微漂移
- README 提到 `<WORKSPACE>/.msgcode/providers.json`，代码中暂无该文件读写实现。
- 这说明 provider 配置域仍在演进中，尚未形成平台化单源。

## 参考对照（osaurus）

1. 配置层（强类型 + 可演进）
- `RemoteProvider` 定义了协议、认证类型、provider 类型、端点、header、timeout、enabled/autoConnect。
- 配置持久化与运行态分离，运行态结构 `RemoteProviderState` 不落盘。

2. 密钥层（Keychain 独立）
- API Key 与 header secrets 独立存取，配置文件不存明文密钥。
- provider 删除时可级联清理密钥。

3. 运行态层（manager 管理生命周期）
- 有 `connect/disconnect/reconnect/connectEnabledProviders`。
- 维护 `isConnecting/isConnected/lastError/discoveredModels`，可驱动 UI。

4. GUI 流程完整
- 可视化 provider 列表、状态徽章、增删改。
- 编辑页内置 preset、连接测试、错误反馈、成功后模型计数回显。

## 关键数据流

1. 当前 msgcode 数据流
- `/model` -> 更新 `AGENT_BACKEND`（全局 `.env`） -> `handlers.resolveGlobalAgentProvider()` -> `resolveAgentBackendRuntime()` -> 请求发送。

2. 建议的目标数据流（三层分离）
- GUI/CLI 写入 `ProviderRegistry`（非密钥）
- GUI/CLI 写入 `ProviderSecrets`（Keychain）
- `ProviderRuntimeManager` 监听配置变化，执行连接测试、模型发现、状态维护
- 会话执行时按 `workspace.activeProviderId` 读取 runtime 快照并发起请求

## 架构差距（Gap）

1. 配置模型
- 现状：`agent.provider` 是枚举值，缺少 provider 实体（host/basePath/headers/timeout 等）。
- 目标：provider 实体化，支持多个同类供应商实例（例如两个 OpenAI-compatible endpoint）。

2. 密钥治理
- 现状：环境变量读密钥，粒度是进程级。
- 目标：provider 级密钥托管（Keychain），并提供 `set/rotate/delete` 生命周期。

3. 运行态可观测
- 现状：请求时即算，缺少长寿命状态机。
- 目标：引入 provider runtime state，给 GUI 与诊断提供实时状态。

4. 入口一致性
- 现状：CLI 与运行链路并不共享一个 provider registry。
- 目标：CLI、GUI、Daemon 共享同一 provider 服务层（同一真相源）。

## 设计建议（v0.1 到 v0.2）

1. Provider 三层分离（先做数据层）
- 配置层（可入库/可落盘，非密钥）
  - 建议文件：`<workspace>/.msgcode/providers.json`
  - 字段：`id/name/type/baseUrl/basePath/model/defaultHeaders/enabled/timeout/priority`
- 密钥层（不可落盘）
  - Provider Secret Store：Keychain 适配器（macOS 先行）
  - 字段：`apiKey` + `secretHeaders`
- 运行态层（内存态）
  - `ProviderRuntimeState`: `status, lastError, modelCount, latency, lastCheckedAt`

2. 状态机最小定义（建议）
- `idle -> connecting -> ready`
- `ready -> degraded`（5xx/超时/限流）
- `degraded -> retrying -> ready|error`
- `error -> connecting`（手动重试或自动恢复）
- `disabled` 为显式停用终态

3. GUI 第一版范围（只做 provider）
- Provider 列表页：显示状态、active 标识、模型数量、错误摘要
- Provider 编辑页：基础信息、密钥输入、连接测试
- 操作：Add/Edit/Delete/Enable/Disable/Set Active/Test
- 先不做：复杂编排、策略可视化、skill 市场

4. 兼容策略（避免一次性断裂）
- 读取优先级建议：
  1) workspace `providers.json`
  2) 旧 `agent.provider`
  3) 全局 `AGENT_BACKEND`
- 写入策略建议：
  - GUI 写新结构
  - `/model` 先兼容写旧结构 + 新结构（过渡期）
  - 最终收敛到新结构单写

## 供应商之外的 GUI 建议（平台化）

1. 配置域中心（Configuration Center）
- 目标：解决当前 `.env + workspace` 混合配置的认知负担。
- 建议：在 GUI 明确三层作用域并可视化覆盖关系。
  - `Global`：用户级默认（原 `~/.config/msgcode/.env` 语义）
  - `Workspace`：项目级覆盖（`.msgcode/config.json` + `providers.json`）
  - `Session/Chat`：临时覆盖（仅当前会话）
- 必要能力：差异对比（diff）、一键回退、来源追踪（值来自哪一层）。

2. 运行态控制台（Runtime Console）
- 目标：让用户看见“系统正在做什么”，降低黑盒感。
- 建议：提供统一状态面板：
  - 当前执行线（agent/tmux）
  - 当前 provider/client
  - 请求状态（queued/running/done/error）
  - 最近错误与恢复动作（retry/failover/degraded）
- 这会直接降低“为什么没回复/为什么回复怪异”的排障成本。

3. 任务与线程视图（Task/Thread Timeline）
- 目标：把 iMessage 交互、tmux 执行、工具调用串成一条可审计时间线。
- 建议：按 `traceId` 聚合展示：
  - 用户输入
  - 路由决策（agent/tmux）
  - 工具调用与结果
  - 最终回复
- 支持导出诊断包，便于 issue 复现。

4. 记忆与人格工作台（Memory + Soul Studio）
- 目标：把“可塑性”从隐式提示词改为显式资产管理。
- 建议：
  - 记忆浏览（L0/L1/L2 可视化）
  - 记忆治理（去重、合并、冻结、删除）
  - SOUL/Skill 版本管理（启用、回滚、工作区覆盖）
- 这部分是社区共建最容易产生复用资产的入口。

5. 安全与权限中心（Safety Center）
- 目标：把高风险开关显式化，避免误操作。
- 建议：
  - 工具白名单与确认策略可视化（`tooling.allow` / `require_confirm`）
  - 文件作用域（workspace/unrestricted）显式提示
  - 外联策略（local-only/egress-allowed）场景说明
- 高风险动作前要求二次确认与审计日志。

6. 社区入口（Community Surface）
- 目标：把“可玩”转成“可共建”。
- 建议：
  - Skill/Template 导入导出
  - 一键分享“最小可复现配置包”（脱敏）
  - 社区模板评分与兼容标记（provider/runtime 兼容矩阵）
- 与产品叙事一致：让用户不仅使用，还能贡献。

7. 分阶段落地顺序（建议）
- P0：Provider Center + Configuration Center（先打通配置与密钥单源）
- P1：Runtime Console + Task Timeline（先解决可观测）
- P2：Memory/Soul Studio + Safety Center（提升治理能力）
- P3：Community Surface（放大生态飞轮）

## 风险点

1. 迁移风险
- 旧 workspace 没有 provider registry，回退逻辑必须稳定。

2. 密钥风险
- Keychain 接口失败时不能导致请求主链崩溃，需降级与告警。

3. 运行态一致性
- provider 切换与会话执行并发时可能出现“读到旧 active provider”的竞态。

4. DX 风险
- 若 CLI 与 GUI 维护两套配置写法，会导致状态漂移。

## 验证方式

1. Docs
- 本文 + `README` 命令口径 + `docs/product` 对外叙事一致性。

2. Code
- 核验入口：`/Users/admin/GitProjects/msgcode/src/routes/cmd-model.ts`
- 核验执行：`/Users/admin/GitProjects/msgcode/src/handlers.ts`
- 核验解析：`/Users/admin/GitProjects/msgcode/src/agent-backend/config.ts`

3. Tests
- 建议新增最小回归：
  - provider 配置读写
  - keychain 读写与清理
  - runtime 状态机转换
  - active provider 切换后请求命中

4. Logs
- 关键字段建议：
  - `providerId`, `providerType`, `executionMode`
  - `providerStatus`, `retryCount`, `failoverTo`, `degraded`, `recoverable`

## 结论

你的判断成立：`osaurus` 在 provider 设计上已经是“平台级分层”，`msgcode` 当前是“可用但未平台化”。

建议从 GUI 的 provider 配置切入，先落地“配置/密钥/运行态”三层分离，再扩展到模型策略与故障转移编排。
