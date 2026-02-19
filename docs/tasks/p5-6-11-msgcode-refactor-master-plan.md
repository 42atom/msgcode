# P5.6.11: msgcode v2.4 重构总控计划（只规划，不改代码）

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
3. Gate：`test`、`bdd`、`docs:check` 全绿。

### Phase 1: 抽取 Agent Loop 抽象

1. 新建 `agent-core/types/events/loop` 最小闭环。
2. 把 loop 从 `lmstudio` 业务混合函数中解耦。
3. Gate：行为不变；命令层回归一致。

### Phase 2: 管道分轨与术语双写

1. 引入运行时新枚举：`agent | client`，并保留 `direct/tmux` 兼容映射。
2. 完成 `pipelines/agent` 与 `pipelines/client` 结构分轨，职责边界固定。
3. Gate：旧术语输入不报错；新术语日志可观测；关键命令回归一致。

### Phase 3: 统一消息类型系统

1. 建立最小消息信封：`role/content/tool/result/ts`（JSON/JSONL 可打印协议）。
2. 将散落消息结构统一收口到 `agent-core/types.ts`，但保持“宽松输入、严格输出”。
3. 禁止设计复杂继承层级；仅保留当前主链路必需字段。
4. Gate：编译严格通过，关键路径无 `implicit any`，消息日志可直接 `cat/grep` 排查。

### Phase 4: 工具接口标准化

1. 引入 `AgentTool` 合同与工厂模式（按 cwd 注入）。
2. `tool-spec` 与 `tool-runtime` 分离，闸门策略保持可测。
3. Gate：工具权限、超时、审计事件契约测试通过。

### Phase 5: Provider 抽象（必要）

1. 先抽内部 Provider 最小接口，不让业务层直接依赖第三方库。
2. Provider 抽象只覆盖“请求、响应、流式输出”差异，不抽象“LLM 概念本体”。
3. 将现有 `lmstudio` 收敛为 provider adapter，再补 `pi-ai` 适配层。
4. Gate：双 provider 契约测试一致，切换无行为漂移，接口字段不超最小集合。

### Phase 6: Session 管理增强

1. 增加会话恢复、分支、压缩、重试、中断注入能力。
2. Session 状态必须保持可打印、可编辑、可修复（纯文本/JSON 文件），禁止黑盒二进制状态。
3. 事件与会话生命周期绑定，支持长会话稳定运行。
4. Gate：长会话压测与恢复演练通过，且可通过手工编辑状态文件恢复。

### Phase 7: 收口与清债

1. 删除重复旧逻辑、过时入口、临时桥接层。
2. 移除旧术语 `direct/tmux` 的非兼容留存入口（按验收清单执行）。
3. 清理 `any` 与临时兼容口子，更新文档与发布说明。
4. Gate：结构收敛后回归全绿，性能无明显退化。

## 4. 对照 pi-mono 建议落实矩阵

| 对照建议 | 是否纳入本计划 | 落实动作 | 对应阶段 | 验收标准 |
|---|---|---|---|---|
| 三层分离（LLM/Loop/业务） | 已纳入（计划） | `agent-core/providers/pipelines` 分层拆分 | Phase 1-5 | 任一业务策略变更不需改 provider 协议层 |
| Agent Loop 抽象干净 | 已纳入（计划） | `loop.ts` 独立 + `convertToLlm/transformContext/getSteering/getFollowUp` 钩子 | Phase 1 | Loop 无业务注入分支 |
| 消息类型系统统一 | 已纳入（计划） | 最小消息信封 + 轻量扩展字段（JSON/JSONL） | Phase 3 | 消息协议单一真相源且可打印 |
| 工具接口标准化+工厂化 | 已纳入（计划） | `AgentTool` 合同 + `createTools(cwd)` | Phase 4 | 工具定义无内联 JSON 散落 |
| Provider 抽象（可接 `pi-ai`） | 已纳入（计划） | 先内部契约，再接 `pi-ai` adapter | Phase 5 | 双 provider 契约测试通过 |
| 事件驱动架构 | 已纳入（计划） | 建立 Agent/Turn/Tool 显式生命周期事件流（非全局 Event Bus） | Phase 1/6 | 日志从“散点文本”升级为结构化 JSONL 事件 |
| 上下文压缩（compaction） | 已纳入（计划） | Session 层实现压缩策略 | Phase 6 | 长会话 token 控制稳定 |
| 终端与智能体结构分轨 | 已纳入（新增） | `pipelines/agent` 与 `pipelines/client` 职责隔离 | Phase 2 | 跨管道无隐式语义注入 |
| 术语收敛（direct/tmux -> agent/client） | 已纳入（新增） | 双写兼容 + 分阶段收口 | Phase 2/7 | 新术语成为唯一主术语 |
| Session 能力完整化 | 已纳入（新增） | 恢复/分支/压缩/重试/中断注入 | Phase 6 | 长会话稳定且可恢复 |

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
4. M4（Phase 5）：Provider 抽象落地，`pi-ai` 适配可切换。
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
