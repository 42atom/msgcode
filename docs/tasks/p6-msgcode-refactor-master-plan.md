# P6: msgcode v2.4 重构总控计划（只规划，不改代码）

> 版本定义：本重构计划对应 `msgcode v2.4` 主版本线。

## 0. 目标与边界

### 0.1 目标

1. 把 `src/lmstudio.ts` 与 `src/tools/bus.ts` 的耦合职责拆开，形成稳定内核。
2. 内化 `pi-mono` 的核心抽象（Loop/Types/Tools/Provider/Event/Session），但不照搬分包形态。
3. 为“复用 msgcode 开发其他业务智能体”建立可复制骨架。
4. 全程 Gate 驱动：每阶段可验收、可回滚、可停止。

### 0.2 非目标

1. 本阶段不新增产品功能。
2. 本阶段不做 UI/交互改版。
3. 本阶段不追求一次性清空全部技术债，优先清理主链路阻塞项。

## 1. 当前基线（启动前冻结）

1. 热点文件：
`src/lmstudio.ts`（1478 行）、
`src/tools/bus.ts`（1063 行）。
2. 测试基线：当前存在失败用例，必须先复绿再做结构性拆分。
3. 已知坏味道：
职责混杂、`any` 扩散、工具与模型协议边界不清、会话能力不足。

## 2. 目标架构（内化到单仓，分层不分包）

### 2.1 分层模型

1. `src/agent-core/`：Agent Loop、最小消息协议、显式事件流、会话状态抽象。
2. `src/providers/`：Provider 契约 + `lmstudio` 适配器 + `pi-ai` 适配器。
3. `src/tools/`：ToolSpec、ToolFactory、ToolGate、ToolRuntime。
4. `src/pipelines/agent/`：智能体管道（SOUL/记忆/tool loop/session）。
5. `src/pipelines/client/`：终端管道（tmux/codex/claude-code 忠实转发与回传）。
6. `src/runtime/`：编排层，只做路由与策略，不承载协议细节。
7. `src/routes/`：命令入口层，仅做分发与参数校验。

### 2.2 命名语义迁移（规划）

1. 运行时标准术语：
`agent`（原 `direct`）、
`client`（原 `tmux`）。
2. 迁移策略：先内部双写映射，再统一对外文案，最后移除旧名。
3. 兼容原则：兼容窗口期内，旧配置/旧输入仍可解析；内部真相源逐步切换到新术语。
4. 验收标准：配置、日志、测试、文档四条线均完成新术语收敛。

### 2.3 目录草案（规划态）

```text
src/
  agent-core/
    types.ts
    events.ts
    loop.ts
    session/
      manager.ts
      compaction.ts
  providers/
    types.ts
    lmstudio.ts
    pi-ai.ts
  tools/
    spec.ts
    factory.ts
    gate.ts
    runtime.ts
  pipelines/
    agent/
      index.ts
      context-injection.ts
      loop-entry.ts
    client/
      index.ts
      tmux-bridge.ts
      responder.ts
  runtime/
    orchestrator.ts
```

### 2.4 分包策略决策

1. 本次与后续同主题重构均采用“分层不分包”策略。
2. `agent-core/providers/tools/pipelines/runtime/routes` 保持单仓同版本演进，不拆独立 npm 包。
3. 如未来确需拆包，必须另立 ADR 并单独立项，不在本计划范围内。

## 3. 分阶段执行计划（Gate 制）

### Phase 0: 基线复绿与冻结

1. 清零当前失败用例，形成可比较基线。
2. 建立 Golden Cases（同输入同输出快照）。
3. 建立 `lmstudio` 线级行为指纹：冻结 `(Input, Raw_Response, Sanitized_Output)` 三元组样本集。
4. Gate：`test`、`bdd`、`docs:check` 全绿；三元组回放一致。

### Phase 1: 抽取 Agent Loop 抽象

1. 新建 `agent-core/types/events/loop` 最小闭环。
2. 引入 Loop 原生钩子点（固定 8 类）：`before_turn`、`after_turn`、`before_llm`、`after_llm`、`before_tool`、`after_tool`、`on_error`、`on_cancel`。
3. 把 loop 从 `lmstudio` 业务混合函数中解耦，并将 `SOUL/summary/anti-loop/steering` 下沉为 hook 策略实现。
4. Gate：行为不变；命令层回归一致；关闭全部 hook 时与基线输出等价；单 hook 失败不拖垮主流程。

### Phase 2: 管道分轨与术语双写

1. 引入运行时新枚举：`agent | client`，并保留 `direct/tmux` 兼容映射。
2. 完成 `pipelines/agent` 与 `pipelines/client` 结构分轨，职责边界固定。
3. 双写兼容窗口必须设置物理倒计时（最多 2 个 Sprint），到期强制进入旧术语清退流程。
4. Gate：旧术语输入不报错；新术语日志可观测；关键命令回归一致；双写倒计时在运行。

### Phase 3: 统一消息类型系统

1. 建立最小消息信封：`role/content/tool/result/ts`（JSON/JSONL 可打印协议）。
2. 将散落消息结构统一收口到 `agent-core/types.ts`，但保持“宽松输入、严格输出”。
3. 禁止设计复杂继承层级；仅保留当前主链路必需字段。
4. Gate：编译严格通过，关键路径无 `implicit any`，消息日志可直接 `cat/grep` 排查。

### Phase 4: 工具接口标准化

1. 引入 `AgentTool` 合同与工厂模式（按 cwd 注入）。
2. `tool-spec` 与 `tool-runtime` 分离，闸门策略保持可测。
3. 工具协议信封前置冻结为 JSON-RPC 2.0 风格（`jsonrpc/method/params/id`），同进程实现也按“外部进程协议”约束。
4. 建立 `capabilities manifest`（文件真相源）声明可用服务与参数契约。
5. 清退 `run_skill` 工具暴露；`skill` 仅保留在智能体编排层，不作为工具面能力。
6. `skill` 必须按需加载：仅注入索引/摘要，不预加载 skill 执行体；触发时才读取对应 skill 文件与脚本。
7. Gate：工具权限、超时、审计事件契约测试通过；`run_skill` 不回流；skill 按需加载链路可观测；JSON-RPC 信封契约测试通过。

### Phase 5: Provider 抽象（必要）

1. 先抽内部 Provider 最小接口，不让业务层直接依赖第三方库。
2. Provider 抽象只覆盖“请求、响应、流式输出”差异，不抽象“LLM 概念本体”。
3. 将现有 `lmstudio` 收敛为 provider adapter，再补 `pi-ai` 适配层。
4. 新增非 `LM Studio` 本地模型切换能力：先接 OpenAI-compatible 本地端点适配层（如 Ollama/vLLM/LocalAI 兼容口）。
5. 供应商依赖策略采用“借依赖，不借边界”：第三方 SDK 仅允许存在于 `providers/*` adapter 层。
6. 系统提示词由 `capabilities manifest` 动态注入能力摘要，不手写长能力清单。
7. Gate：`lmstudio` 与至少 1 个非 `LM Studio` 本地 provider 可配置切换；双 provider 契约测试一致；切换无行为漂移；接口字段不超最小集合。

### Phase 6: Session 管理增强

1. 增加会话恢复、分支、压缩、重试、中断注入能力。
2. Session 状态必须保持可打印、可编辑、可修复（纯文本/JSON 文件），禁止黑盒二进制状态。
3. Session 历史采用 append-only JSONL journaling，配合周期性 snapshot；禁止“单文件全量覆写”作为唯一状态持久化方案。
4. 记忆必须按需加载：仅在命中注入闸门（enabled + 关键词/force）后触发检索与 store 加载。
5. 事件与会话生命周期绑定，支持长会话稳定运行。
6. Gate：长会话压测与恢复演练通过，且可通过手工编辑状态文件恢复；记忆按需加载行为稳定且可观测；journal 回放可恢复状态。

### Phase 7: 收口与清债

1. 删除重复旧逻辑、过时入口、临时桥接层。
2. 移除旧术语 `direct/tmux` 的非兼容留存入口（按验收清单执行）。
3. 清理 `any` 与临时兼容口子，更新文档与发布说明。
4. Gate：结构收敛后回归全绿，性能无明显退化。

## 4. 对照 pi-mono 建议落实矩阵

| 对照建议 | 是否纳入本计划 | 落实动作 | 对应阶段 | 验收标准 |
|---|---|---|---|---|
| 三层分离（LLM/Loop/业务） | 已纳入（计划） | `agent-core/providers/pipelines` 分层拆分 | Phase 1-5 | 任一业务策略变更不需改 provider 协议层 |
| Agent Loop 抽象干净 | 已纳入（计划） | `loop.ts` 独立 + 原生 8 类 hook；`convertToLlm/transformContext/getSteering/getFollowUp` 通过适配层映射到 hook | Phase 1 | Loop 无业务注入分支，hook 全关与基线等价 |
| 消息类型系统统一 | 已纳入（计划） | 最小消息信封 + 轻量扩展字段（JSON/JSONL） | Phase 3 | 消息协议单一真相源且可打印 |
| 工具接口标准化+工厂化 | 已纳入（计划） | `AgentTool` 合同 + `createTools(cwd)` | Phase 4 | 工具定义无内联 JSON 散落 |
| Provider 抽象（可接 `pi-ai`） | 已纳入（计划） | 先内部契约，再接 `pi-ai` adapter | Phase 5 | 双 provider 契约测试通过 |
| 非 LM Studio 本地模型切换 | 已纳入（新增） | 接入 OpenAI-compatible 本地 provider adapter，并支持配置切换 | Phase 5 | 切换 provider 不改业务层代码 |
| 能力清单单一真相源 | 已纳入（新增） | `capabilities manifest` + 提示词动态注入摘要 | Phase 4/5 | 改服务无需手改提示词 |
| `run_skill` 工具面清退 | 已纳入（新增） | 从 Tool Surface 删除 `run_skill`，仅保留编排层 skill | Phase 4/7 | 主链工具定义不再出现 `run_skill` |
| skill 按需加载 | 已纳入（新增） | 仅注入 skill 索引/摘要；执行体按需读取 | Phase 4/5 | 冷启动无 skill 执行体预加载，触发时才加载 |
| 工具协议边界前置冻结 | 已纳入（新增） | JSON-RPC 2.0 信封契约先行 | Phase 4 | agent-core 不耦合工具实现细节 |
| 事件驱动架构 | 已纳入（计划） | 建立 Agent/Turn/Tool 显式生命周期事件流（非全局 Event Bus） | Phase 1/6 | 日志从“散点文本”升级为结构化 JSONL 事件 |
| 上下文压缩（compaction） | 已纳入（计划） | Session 层实现压缩策略 | Phase 6 | 长会话 token 控制稳定 |
| 记忆按需加载 | 已纳入（新增） | `memory` 检索在闸门命中后才加载与执行 | Phase 6 | 未命中场景不触发 memory store 加载 |
| Session append-only 历史 | 已纳入（新增） | JSONL journal + snapshot 组合 | Phase 6 | 崩溃后可回放可修复 |
| 终端与智能体结构分轨 | 已纳入（新增） | `pipelines/agent` 与 `pipelines/client` 职责隔离 | Phase 2 | 跨管道无隐式语义注入 |
| 术语收敛（direct/tmux -> agent/client） | 已纳入（新增） | 双写兼容 + 分阶段收口 | Phase 2/7 | 新术语成为唯一主术语 |
| Session 能力完整化 | 已纳入（新增） | 恢复/分支/压缩/重试/中断注入 | Phase 6 | 长会话稳定且可恢复 |
| OV 可观测闭环 | 已纳入（新增） | 统一结构化事件字段 + JSONL 落盘 + 回放校验 | Phase 3/6/7 | 工具/记忆/会话链路均可追踪与回放 |

说明：当前为“计划已落实”，代码层为“待实施”。

## 5. 风险清单与止损策略

| 风险 | 影响 | 控制措施 | 止损点 |
|---|---|---|---|
| 在回归未复绿时硬拆结构 | 回归难定位 | 强制 Phase 0 先行 | 基线不绿即暂停后续阶段 |
| 术语改名与结构改造叠加 | 变更面过大 | 先双写兼容，再切主语义 | 兼容测试不通过即冻结改名 |
| Provider 抽象过度设计 | 工期膨胀 | 先单 provider 契约落地 | 仅保留最小必需字段 |
| Session 改造触发历史兼容问题 | 会话丢失或行为漂移 | 迁移演练+回放测试 | 保留旧格式只读回退窗口 |
| 工具工厂改造影响权限闸门 | 安全回归 | Gate 契约测试先行 | 任一闸门失败即回滚该阶段 |

## 6. 质量与约束

1. TypeScript 规则：启用 `noImplicitAny` 与 `@typescript-eslint/no-explicit-any`。
2. 确需 `any` 的地方必须注释“原因 + 何时移除”。
3. 任一核心文件超过 800 行必须触发拆分审查。
4. 三层以上缩进视为设计异味，优先重构而非补分支。
5. 不引入全局 Event Bus 作为核心控制流；优先显式调用链、回调链或流式管线。
6. 事件观测必须落盘为可读 JSONL，不允许只存在内存态黑盒事件。
7. YAGNI 约束：新抽象必须有至少 2 个真实调用方需求，否则延后。

## 7. 启动前检查单（必须全部通过）

1. 基线用例复绿并冻结报告。
2. 各阶段 ADR 完成并评审签字。
3. Golden Cases 与契约测试模板准备就绪。
4. 回滚策略已演练（至少一次）。
5. 负责人、评审人、灰度窗口明确。

## 8. 里程碑交付物

1. M1（Phase 0-1）：Loop/事件内核骨架完成，行为不变。
2. M2（Phase 2）：`agent/client` 分轨完成，术语双写兼容到位。
3. M3（Phase 3-4）：消息与工具标准化完成，`lmstudio` 明显瘦身。
4. M4（Phase 5）：Provider 抽象落地，支持 `lmstudio` 与非 `LM Studio` 本地 provider 切换，`pi-ai` 适配可切换。
5. M5（Phase 6-7）：Session 完整能力与清债收口完成。

## 9. 本文档状态

1. 状态：评审草案（Draft）。
2. 变更策略：仅在架构评审结论后更新，不随临时代码波动频繁改写。

## 10. 对外公布条件

1. 本文档当前仅作为内部推敲草案，不作为执行公告。
2. 仅当“阶段 Gate、风险评审、回滚演练”三项均签收后，才可对外公布为执行计划。
3. 公布版本必须附带：阶段负责人、时间窗、回滚点与验收记录模板。

## 11. 评审反馈落地结论（Unix 导向）

1. 接受“少即是多”：避免中层过度抽象，优先可运行与可维护。
2. 接受“透明优先”：状态与事件必须可在文件系统直接观察与修复。
3. 接受“组合优先”：优先显式管线组合，不依赖隐式全局事件广播。
4. 接受“按需抽象”：Provider 与消息层只做最小必要抽象，避免提前泛化。

## 12. 术语表（统一口径）

1. `agent`：
智能体管道（原 `direct`），负责模型调用、工具循环、SOUL/记忆注入与会话策略。
2. `client`：
终端管道（原 `tmux`），负责终端交互、转发与回传，不承载智能体业务语义。
3. `provider adapter`：
模型供应商适配层；仅处理请求/响应/流式差异，不抽象“LLM 概念本体”。
4. `最小消息信封`：
`role/content/tool/result/ts` 的 JSON/JSONL 协议，宽松输入、严格输出、可打印可排障。
5. `显式事件流`：
Agent/Turn/Tool 生命周期事件通过显式调用链与可读 JSONL 输出，不使用全局 Event Bus。
6. `session state`：
可打印、可编辑、可修复的文本状态文件；禁止黑盒二进制状态。
7. `双写兼容窗口`：
术语迁移阶段同时接受新旧名称（`agent/client` 与 `direct/tmux`），最终收口为新术语。
8. `Gate`：
阶段切换硬门禁；不满足测试与回滚条件不得进入下一阶段。
9. `capabilities manifest`：
服务能力文件真相源；系统提示词从该文件动态生成能力摘要。
10. `OV`：
`Observability Verification`，指“可观测字段完整 + 事件落盘 + 可回放验证”的闭环验收。

## 13. 不可违反约束（Hard Rules）

1. 结构策略固定为“分层不分包”；本计划内禁止拆独立 npm 包。
2. 禁止将全局 Event Bus 作为核心控制流；必须采用显式调用链、回调链或流式管线。
3. Session 状态必须可手工修复；任何不可读黑盒状态一律不接收。
4. Provider 抽象必须保持最小边界；只抽协议差异，不抽象业务与概念层。
5. 消息模型必须保持最小信封协议；禁止演进为复杂继承体系。
6. 新抽象必须满足 YAGNI 门槛：至少 2 个真实调用方需求，否则延后。
7. 术语迁移必须“先兼容后切换”；不得直接破坏旧配置与旧输入。
8. 每阶段必须通过 Gate（`test`/`bdd`/`docs:check` + 回滚点）后才能推进。
9. 任一架构级变更都必须同步更新对应 README 与计划文档，禁止文档滞后。
10. 若出现规则冲突，优先级为：可修复性 > 透明性 > 简单性 > 扩展性。
11. `handlers` 必须保持薄路由，不得继续承载跨域业务编排。
12. `listener` 必须按管线拆分（source/filter/router/processor/sink），禁止单函数混合策略与机制。
13. `tools/bus` 不得继续作为硬编码依赖中心，工具注册必须转向插件化与协议化。
14. `skill` 定位为智能体自主演化与任务编排层；平台只提供运行保障，不介入编排决策。
15. 平台不得对 `skill` 编排做人工策略干预（不做路径限制、不做内容审查）；仅可提供资源边界、超时、隔离与故障恢复能力。
16. 服务能力声明必须以 `capabilities manifest` 为单一真相源；禁止手工维护多份提示词能力清单。
17. 本次 `v2.4` 重构中，`run_skill` 必须从工具暴露面移除，不作为 LLM Tool Call 能力存在。
18. Agent Loop 必须采用原生钩子化，钩子点固定为 8 类：`before_turn`、`after_turn`、`before_llm`、`after_llm`、`before_tool`、`after_tool`、`on_error`、`on_cancel`。
19. 业务策略必须通过 hook 注入；禁止将策略逻辑回灌到 loop 主流程分支。
20. hook 执行必须失败隔离与可观测：单 hook 错误只影响该 hook，且必须记录结构化事件（含阶段、耗时、错误）。
21. `skill` 运行链必须按需加载：禁止在主链冷启动阶段扫描并加载全部 skill 执行体。
22. `memory` 检索链必须按需加载：未命中注入闸门时，禁止加载 memory store 或触发检索。
23. `OV` 必须覆盖工具、记忆、会话三条链路，且事件需落盘为可读 JSONL；仅内存态 telemetry 不计为“生效”。
24. 任一链路的 `OV` 验证失败视为 Gate 失败，不得进入下一阶段。
25. 分层边界必须由静态规则强制（`import/no-restricted-paths` 或 `dependency-cruiser`），禁止仅靠约定执行。
26. 工具调用协议必须以 JSON-RPC 2.0 信封作为统一边界，禁止在 agent-core 直接依赖工具实现内部参数形态。
27. Session 历史必须支持 append-only journal 回放；snapshot 仅用于加速恢复，不得替代可追溯日志。
28. 第三方供应商依赖只允许出现在 `providers/*` adapter 层；`agent-core/pipelines/tools/runtime/routes` 禁止直接依赖供应商 SDK。
29. Provider 切换必须由配置驱动；业务层禁止出现 `if provider === ...` 分支。

### 13.1 Skill 平台边界声明（执行口径）

1. 平台职责：保证 `skill` 可运行、可恢复、可观测。
2. 平台非职责：规定 `skill` 如何规划任务、如何选择步骤、如何组织策略。
3. 执行原则：`只保运行无碍，不干预智能体编排`。

## 14. 第二轮审核意见落地（Unix 视角）

1. 结论：
新审核意见与 `v2.4` 方向一致，核心是“进一步去巨型文件与去硬编码中心”。
2. 已覆盖项：
`分层不分包`、`最小消息协议`、`非全局 Event Bus`、`Session 可修复`。
3. 需补强项：
`lmstudio` 拆解深度、`tools/bus` 插件化、`handlers/listener` 进一步薄化。

### 14.1 对照落地矩阵

| 审核关注点 | 当前计划状态 | v2.4 补强动作 | 对应阶段 | 验收口径 |
|---|---|---|---|---|
| `src/lmstudio.ts` 单体过大 | 已覆盖但不够细 | 强制拆为 `providers/lmstudio/*`：`native/openai-compat/sanitizer/retry-policy` | Phase 5/7 | `lmstudio.ts` 不再承载跨层策略 |
| `src/tools/bus.ts` 硬编码中枢 | 部分覆盖 | 引入工具注册表 + 插件发现，执行口改为协议边界（JSON over stdio/回调适配） | Phase 4/7 | 新工具接入无需修改总线核心分发逻辑 |
| `src/handlers.ts` God Class | 已覆盖 | 强制改为 map-dispatch 薄路由，命令处理器独立文件化 | Phase 2/7 | 处理器变更不影响路由骨架 |
| `src/listener.ts` 混合机制与策略 | 已覆盖 | 固化流水线：`source -> whitelist/filter -> router -> enrich/process -> sink` | Phase 2/6 | 各阶段可独立测试与回放 |
| 状态分散与恢复困难 | 已覆盖 | 状态收敛为可读文本真相源，补“崩溃恢复一致性”校验用例 | Phase 6/7 | 手工修复后系统可继续处理且不重放脏数据 |

### 14.2 新增 Gate（防回流）

1. `lmstudio` 拆分 Gate：
静态扫描不得再出现“协议适配 + 策略注入 + 清洗 + 重试”同文件共存。
2. `tools/bus` Gate：
新增工具以注册方式接入，不允许新增核心 switch 分发分支。
3. `handlers/listener` Gate：
`handlers` 仅路由；`listener` 仅机制入口；策略逻辑必须下沉到独立处理器。
4. 状态一致性 Gate：
崩溃恢复用例必须验证 cursor/session/window 三者一致推进。

## 15. 附件 A：v2.4 任务分解（WBS）

说明：以下任务仅用于重构执行，不包含新功能开发。

| 任务 ID | 阶段 | 任务 | 交付物 | 依赖 | 预估 |
|---|---|---|---|---|---|
| T0-1 | Phase 0 | 失败用例清零与归因归档 | 基线复绿报告 | 无 | 1-2d |
| T0-2 | Phase 0 | Golden Cases 样本冻结 | `golden-cases.md` | T0-1 | 0.5d |
| T0-3 | Phase 0 | 回滚演练脚本确定 | `rollback-playbook.md` | T0-1 | 0.5d |
| T0-4 | Phase 0 | `lmstudio` 线级三元组录制 | `wire-fingerprint.jsonl` | T0-1 | 0.5d |
| T0-5 | Phase 0 | sanitizer 等价性回放脚本 | 三元组一致性报告 | T0-4 | 0.5d |
| T1-1 | Phase 1 | 抽 `agent-core/loop.ts` 骨架 | loop 入口与调用链 | T0-2 | 1d |
| T1-2 | Phase 1 | 抽 `agent-core/events.ts`（显式事件流） | 生命周期事件定义 | T1-1 | 0.5d |
| T1-3 | Phase 1 | loop 接入现有运行链（行为不变） | 回归通过记录 | T1-1 | 1d |
| T1-4 | Phase 1 | 原生 8 类 hook 合同落地 + 兼容映射 | hook 接口与适配层 | T1-1,T1-2 | 1d |
| T2-1 | Phase 2 | 新枚举落地：`agent/client` + 兼容映射 | 运行时枚举与兼容层 | T1-3 | 1d |
| T2-2 | Phase 2 | 建立 `pipelines/agent` 骨架 | agent 管道入口 | T2-1 | 1d |
| T2-3 | Phase 2 | 建立 `pipelines/client` 骨架 | client 管道入口 | T2-1 | 1d |
| T2-4 | Phase 2 | `handlers` 路由 map 化 | 薄路由分发器 | T2-2,T2-3 | 1d |
| T2-5 | Phase 2 | `listener` 管线拆分骨架 | source/filter/router/sink | T2-3 | 1d |
| T2-6 | Phase 2 | 双写兼容倒计时机制 | 时间盒与清退日历 | T2-1 | 0.5d |
| T2-7 | Phase 2 | 分层边界 lint 规则落地 | `eslint`/`dep-cruise` 规则集 | T2-2,T2-3 | 0.5d |
| T3-1 | Phase 3 | 定义最小消息信封 | `agent-core/types.ts` | T2-5 | 0.5d |
| T3-2 | Phase 3 | 旧消息结构适配到最小信封 | 消息适配层 | T3-1 | 1d |
| T3-3 | Phase 3 | 消息 JSONL 落盘与回放 | 可观测消息日志 | T3-2 | 1d |
| T4-0 | Phase 4 | JSON-RPC 工具协议信封冻结 | 协议文档 + 契约测试样例 | T3-3 | 0.5d |
| T4-1 | Phase 4 | 工具注册表抽取 | `tools/registry.ts` | T3-3 | 1d |
| T4-2 | Phase 4 | 工具执行协议边界收敛（JSON） | 统一执行协议 | T4-1 | 1d |
| T4-3 | Phase 4 | `tools/bus` 去核心 switch 化 | 插件式分发入口 | T4-2 | 1d |
| T4-4 | Phase 4 | `DesktopSessionPool` 独立模块化 | 独立池管理器 | T4-3 | 0.5d |
| T4-5 | Phase 4 | `capabilities manifest` 落地 | 服务能力声明文件 | T4-3 | 0.5d |
| T4-6 | Phase 4 | `run_skill` 工具面清退 | tools/types + tools/bus 收口 | T4-3 | 0.5d |
| T4-7 | Phase 4 | skill 按需加载收口 | skill 索引注入与懒加载执行链 | T4-5,T4-6 | 0.5d |
| T5-1 | Phase 5 | Provider 最小接口定义 | `providers/types.ts` | T4-2 | 0.5d |
| T5-2 | Phase 5 | `lmstudio` 拆分为子模块 | native/openai/sanitizer/retry | T5-1 | 2d |
| T5-3 | Phase 5 | `pi-ai` 适配接入 | `providers/pi-ai.ts` | T5-1 | 1d |
| T5-4 | Phase 5 | 双 provider 契约测试 | `test/providers/*` | T5-2,T5-3 | 1d |
| T5-5 | Phase 5 | 提示词动态注入能力摘要 | prompt 注入器 | T4-5,T5-4 | 0.5d |
| T5-6 | Phase 5 | OV 字段统一（provider/tool/session） | 结构化事件字段字典 | T5-4 | 0.5d |
| T5-7 | Phase 5 | 非 LM Studio 本地 provider 接入 | `providers/openai-local.ts`（或等价） | T5-1 | 1d |
| T5-8 | Phase 5 | provider 切换回归（本地双 provider） | 切换回归报告 | T5-2,T5-7 | 0.5d |
| T5-9 | Phase 5 | 供应商依赖边界扫描 | 禁跨层依赖报告 | T2-7,T5-7 | 0.5d |
| T6-0 | Phase 6 | append-only journal 方案落地 | `state/session/*.jsonl` 方案 | T5-4 | 0.5d |
| T6-1 | Phase 6 | session 文本状态收敛 | `state/session/*.json` 方案 | T5-4 | 1d |
| T6-2 | Phase 6 | 崩溃恢复一致性机制 | cursor/window/session 对齐 | T6-1 | 1d |
| T6-3 | Phase 6 | 压缩/重试/中断注入接线 | session 管理增强 | T6-2 | 1d |
| T6-4 | Phase 6 | 记忆按需加载收口 | memory 闸门与懒加载验证 | T6-1 | 0.5d |
| T6-5 | Phase 6 | OV 回放验收脚本 | JSONL 回放与对账报告 | T5-6,T6-2 | 0.5d |
| T7-1 | Phase 7 | 移除旧术语主路径引用 | `direct/tmux` 清退 | T2-1 | 1d |
| T7-2 | Phase 7 | 兼容层缩减与收口 | 兼容窗口结束说明 | T7-1 | 0.5d |
| T7-3 | Phase 7 | 文档与发布说明对齐 | README + release notes | T7-2 | 0.5d |

## 16. 附件 B：Phase Gate 勾选清单（评审版）

### 16.1 Phase 0 Gate

- [ ] `test` 全绿
- [ ] `bdd` 全绿
- [ ] `docs:check` 全绿
- [ ] 基线失败项已归因并关闭
- [ ] Golden Cases 已冻结
- [ ] 回滚脚本可执行
- [ ] `lmstudio` 三元组样本（Input/Raw/Sanitized）已冻结
- [ ] sanitizer 回放一致性通过（同 Raw 得到同 Sanitized）

### 16.2 Phase 1 Gate

- [ ] `loop/events` 已独立，不含业务注入逻辑
- [ ] 运行行为与基线一致
- [ ] 事件流可追踪（显式调用链）
- [ ] 无全局 Event Bus 引入
- [ ] 原生 8 类 hook 已落地（名称与语义固定）
- [ ] 全部 hook 关闭时与基线输出等价
- [ ] 单 hook 失败不影响主流程推进（失败隔离已验证）
- [ ] hook 调用具备结构化追踪（阶段/耗时/错误）

### 16.3 Phase 2 Gate

- [ ] `agent/client` 新术语可运行
- [ ] `direct/tmux` 旧输入仍兼容
- [ ] `pipelines/agent` 与 `pipelines/client` 已分轨
- [ ] `handlers` 仅路由，不含跨域业务逻辑
- [ ] `listener` 完成 source/filter/router/sink 拆分
- [ ] 双写倒计时已启动（<= 2 Sprint）
- [ ] 分层边界 lint 规则生效并阻断跨层依赖

### 16.4 Phase 3 Gate

- [ ] 最小消息信封生效（JSON/JSONL）
- [ ] 消息日志可 `cat/grep` 排障
- [ ] 不存在复杂消息继承层级
- [ ] “宽松输入、严格输出”测试通过

### 16.5 Phase 4 Gate

- [ ] 新工具通过注册表接入
- [ ] `tools/bus` 无新增核心 switch 分支
- [ ] 工具执行协议统一（JSON 边界）
- [ ] 审计日志字段完整（tool/source/duration/result）
- [ ] `DesktopSessionPool` 已解耦
- [ ] `capabilities manifest` 已落地并可被读取
- [ ] `run_skill` 不再出现在 Tool Surface（定义/暴露/调用）
- [ ] skill 执行体未在冷启动预加载（按需触发才读取）
- [ ] skill 触发链路日志可观测（至少含 skillId/source/duration/result）
- [ ] JSON-RPC 信封契约测试通过（同进程/伪外进程口径一致）

### 16.6 Phase 5 Gate

- [ ] Provider 最小接口冻结
- [ ] `lmstudio` 逻辑拆分完成（native/openai/sanitizer/retry）
- [ ] `pi-ai` 适配可切换
- [ ] 双 provider 契约测试一致
- [ ] 未引入“LLM 概念本体”抽象层
- [ ] 系统提示词能力摘要由 `capabilities manifest` 动态注入
- [ ] OV 字段字典统一并发布（provider/tool/session 同口径）
- [ ] `lmstudio` 与至少 1 个非 `LM Studio` 本地 provider 可配置切换
- [ ] provider 切换无需修改业务层代码
- [ ] 供应商 SDK 依赖未越过 provider adapter 边界（静态扫描通过）

### 16.7 Phase 6 Gate

- [ ] session 状态为纯文本/JSON
- [ ] 崩溃恢复后 cursor/window/session 一致推进
- [ ] 支持手工修复后继续运行
- [ ] 压缩/重试/中断注入路径可观测
- [ ] 未命中注入闸门时不加载 memory store
- [ ] 命中注入闸门时记忆注入字段完整（hitCount/injectedChars/usedPaths）
- [ ] Session journal 为 append-only，且可回放恢复
- [ ] snapshot + journal 联合恢复演练通过

### 16.8 Phase 7 Gate

- [ ] 主路径不再使用 `direct/tmux`
- [ ] 兼容窗口结束并有说明
- [ ] `any` 清理达到约束线
- [ ] 文档、计划、发布说明已对齐
- [ ] 全量回归全绿且性能无明显退化
- [ ] 全仓主链不再存在 `run_skill` 工具暴露（仅允许历史文档引用）
- [ ] OV 回放报告通过（工具/记忆/会话三链路）

## 17. 附件 C：风险登记册（执行态）

| 风险 ID | 风险描述 | 触发信号 | 监控方式 | 缓解动作 | 回滚动作 |
|---|---|---|---|---|---|
| R-01 | 改名引发兼容破坏 | 旧命令/旧配置失效 | 兼容回归测试 | 双写兼容窗口延长 | 回退到旧枚举解析层 |
| R-02 | 分轨后跨层调用反增 | pipeline 间反向依赖增加 | 静态依赖扫描 | 强制边界 lint 规则 | 回退最近分轨提交 |
| R-03 | Provider 抽象膨胀 | 接口字段持续增长 | PR 审查清单 | 严格最小接口审查 | 回退新增字段层 |
| R-04 | `lmstudio` 拆分后行为漂移 | Golden Case 输出不一致 | 快照回放 | 差异定位到子模块 | 回退到拆分前 adapter |
| R-05 | 工具协议改造影响稳定性 | 工具成功率下降 | tool telemetry 指标 | 分批灰度迁移工具 | 切回旧执行入口 |
| R-06 | listener 管线拆分导致漏处理 | 收到消息但无响应 | 入站/出站对账 | 增加 pipeline 追踪 ID | 临时回滚到旧 listener |
| R-07 | session 新状态与旧数据冲突 | 恢复失败或重复处理 | 恢复回放用例 | 加读时迁移与校验 | 回退到旧状态读取器 |
| R-08 | 文档与代码口径漂移 | 评审结论无法复现 | docs:check + PR 模板 | 文档变更强制同步 | 阻断合并，回滚文档 |
| R-09 | skill 回流为预加载模式 | 冷启动时间上升、内存占用异常 | 冷启动 profile + 模块加载日志 | 强制 skill 懒加载检查项 | 回退到懒加载实现 |
| R-10 | OV 假生效（只内存不落盘） | 现场无法回放与对账 | JSONL 落盘审计 + 回放脚本 | 将关键事件强制落盘并回放验收 | 回退到上个可回放版本 |
| R-11 | 供应商依赖越层渗透 | 业务层被 SDK 绑死、切换成本升高 | 依赖图与静态扫描 | 强制 adapter 边界 + 依赖审查 | 回退越层依赖提交 |

## 18. 附件 D：评审展示顺序（对外阅读版）

1. 先读第 2 章（目标架构）与第 3 章（阶段计划）。
2. 再读第 13 章（Hard Rules）确认不可违反约束。
3. 然后读第 15 章（WBS）确认任务粒度与依赖。
4. 最后读第 16/17 章（Gate + 风险）确认执行可控性。
5. 需要技术依据时，最后读第 20 章（R6 对照评审原文引用）。

## 19. 附件 E：执行控制附录（硬钉子）

### 19.1 Golden Cases 最小清单（Phase 0 冻结）

以下为最低覆盖，不得删减：

1. `agent` 基础对话：无工具、无记忆注入、正常回复。
2. `agent` 工具闭环：单工具调用（成功路径）。
3. `agent` 工具失败：超时/权限拒绝/执行错误三类失败路径。
4. `client` 忠实转发：输入原样发送、输出原样回传。
5. `client` 读取回退：主读取模式失败后 fallback 行为一致。
6. Provider A/B 一致性：`lmstudio` 与 `pi-ai` 对同一输入的契约等价。
7. Session 恢复：进程重启后会话可继续，不重复消费。
8. Session 手工修复：编辑状态文件后系统可恢复推进。
9. 术语兼容：`direct/tmux` 与 `agent/client` 双写窗口内均可解析。
10. 崩溃一致性：cursor/window/session 三者推进一致，无脏重放。
11. `/reload` 关键回执：配置生效信息与运行态一致。
12. 文档契约：`docs:check` 与运行命令口径一致。
13. skill 按需加载：冷启动阶段无 skill 执行体预加载，触发时才读取目标 skill。
14. 记忆按需加载：未命中注入闸门时不加载 memory store，命中时注入字段完整。
15. OV 回放：工具/记忆/会话三链路的 JSONL 事件可回放且结果可对账。
16. 本地模型切换：`lmstudio` 与至少 1 个非 `LM Studio` 本地 provider 可配置切换，业务层零改动。

### 19.2 Dual Write 退出条件（Phase 2 -> Phase 7）

1. 双写窗口时间盒固定为 `<= 2 Sprint`，到期必须执行清退评审，不得自动延期。
2. 连续两个小版本窗口内，`direct/tmux` 入口命中率为 0（日志可证）。
3. 兼容入口仅剩外部历史输入适配，不再被主链内部调用。
4. 所有用户文档、帮助文案、日志字段均以 `agent/client` 为唯一主术语。
5. 回归与 Golden Cases 全绿后，方可执行兼容层移除。

### 19.3 阶段 Owner 与时间盒（模板）

| Phase | Owner | 预计工期 | 最晚截止日 | 状态 |
|---|---|---|---|---|
| Phase 0 | 待指定 | 2-3d | 待填 | 未开始 |
| Phase 1 | 待指定 | 2-3d | 待填 | 未开始 |
| Phase 2 | 待指定 | 3-5d | 待填 | 未开始 |
| Phase 3 | 待指定 | 2-3d | 待填 | 未开始 |
| Phase 4 | 待指定 | 3-4d | 待填 | 未开始 |
| Phase 5 | 待指定 | 3-4d | 待填 | 未开始 |
| Phase 6 | 待指定 | 3-4d | 待填 | 未开始 |
| Phase 7 | 待指定 | 1-2d | 待填 | 未开始 |

### 19.3A 执行工期评估（C兄口径）

1. 总体评估：若由 C兄执行本次重构，预计需要 `10-14` 个工作日（约 `2` 周）专注时间。
2. 最快情况：`10` 天（测试覆盖足够，且未出现异常 iMessage 行为差异）。
3. 正常情况：`14` 天（`lmstudio` 与 `tools/bus` 隐式耦合排查通常超预期）。

| 阶段 | 预估耗时 | 复杂度/风险点 |
|---|---|---|
| Phase 0: 基线复绿 | 1d | 主要是修复 `bun:test` 环境问题与 flaky tests。 |
| Phase 1: Loop 抽取 | 2d | `agent-core` 为心脏手术，需谨慎剥离 `lmstudio.ts` 业务逻辑并保持行为不变。 |
| Phase 2: Client/Agent 分轨 | 2d | 以文件移动与重命名为主，风险是漏改导致运行时报错。 |
| Phase 3: 消息协议 | 1d | 主要是 TypeScript 类型收敛与适配。 |
| Phase 4: 工具总线重构 | 3d | `tools/bus.ts` 耦合深，插件化注册表改造风险高。 |
| Phase 5: Provider 拆分 | 3d | `lmstudio.ts` 需拆为 `native/openai/retry/sanitize` 等子模块。 |
| Phase 6: Session 状态 | 2d | 崩溃恢复与手工编辑恢复需要较重测试验证。 |
| Phase 7: 收口清理 | 1d | 删除旧逻辑与文档对齐。 |

执行策略建议（时间维度）：
1. `Phase 0` 与 `Phase 1` 以稳定优先，可放慢节奏确保基线可靠。
2. `Phase 4` 与 `Phase 5` 为攻坚段，建议预留缓冲并连续排期。

### 19.4 统一回滚触发线（任何一条触发即回滚）

1. 阶段 Gate 任一项失败。
2. Golden Cases 回放出现未授权偏差。
3. 回复成功率、工具成功率、会话恢复成功率任一指标跌破阈值。
4. 关键路径性能明显退化且无法在时间盒内修复。
5. 文档契约与运行行为出现不可接受分歧。

### 19.5 观测 KPI（阶段准入/准出）

| 指标 | 定义 | 采集方式 | 准出要求 |
|---|---|---|---|
| 回复成功率 | 成功回复数 / 总请求数 | 结构化日志聚合 | 不低于基线 |
| 工具成功率 | 成功工具调用 / 总调用 | tool telemetry | 不低于基线 |
| 会话恢复成功率 | 恢复成功会话 / 恢复尝试 | session 恢复日志 | 不低于基线 |
| 平均响应时延 | 请求到首条可发送输出的平均时延 | 端到端打点 | 不高于基线显著阈值 |
| 崩溃后重放率 | 崩溃后重复处理比例 | cursor/window/session 对账 | 接近 0，且不高于基线 |
| skill 懒加载命中率 | 触发时加载次数 / 冷启动预加载次数 | 模块加载事件统计 | 冷启动预加载应为 0 |
| memory 闸门误触发率 | 未命中场景却触发检索比例 | 记忆闸门日志对账 | 接近 0，且不高于基线 |
| OV 回放通过率 | 回放成功用例 / 回放总用例 | 回放脚本报告 | 100% 通过（Gate 级） |
| sanitizer 等价通过率 | 三元组中 Sanitized 输出一致比例 | wire-level 回放报告 | 100% 通过（Gate 级） |
| provider 切换成功率 | 配置切换后成功请求数 / 切换后总请求数 | provider 切换回归报告 | 100% 通过（Gate 级） |

注：阈值在 Phase 0 基线冻结后填写，不允许执行中途随意调低标准。

## 20. 附件 F：R6 对照评审原文（引用）

该附件作为 `P6` 重构计划的技术依据输入，不单独成主线。

引用文档：
`/Users/admin/GitProjects/msgcode/docs/tasks/p5-6-10-r6-pi-mono-benchmark-and-adoption.md`

使用规则：

1. 作为“可借鉴机制清单”的来源，服务于 `P6` 的阶段任务拆解。
2. 与 `P6` 冲突时，以 `P6` 的 Hard Rules 与 Gate 为准。
3. 不做“整包移植”依据，仅做“机制迁移”依据（单上下文、失败短路、参数校验、事件流、总线分层）。
