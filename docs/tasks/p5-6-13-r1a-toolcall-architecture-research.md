# P5.6.13-R1A：Tool Calling 架构调研（openclaw / pi-mono / msgcode）

## 目的

在开新实施单前，先回答 4 个关键问题，避免继续“修一个点，漂一片”：

1. 模型工具调用是否可证明正确。
2. 模型供应商切换是否有稳定边界。
3. 模型能否通过读取 skill 有效展开工具并交付结果。
4. 工具相关提示词注入应如何设计，才不和业务提示互相污染。

## 阅读范围（证据）

- pi-mono
  - `/Users/admin/GitProjects/GithubDown/pi-mono/packages/agent/src/agent-loop.ts`
  - `/Users/admin/GitProjects/GithubDown/pi-mono/packages/agent/src/types.ts`
  - `/Users/admin/GitProjects/GithubDown/pi-mono/packages/ai/src/providers/transform-messages.ts`
  - `/Users/admin/GitProjects/GithubDown/pi-mono/packages/coding-agent/src/core/system-prompt.ts`
- openclaw
  - `/Users/admin/GitProjects/GithubDown/openclaw/src/agents/pi-tools.ts`
  - `/Users/admin/GitProjects/GithubDown/openclaw/src/agents/tool-policy-pipeline.ts`
  - `/Users/admin/GitProjects/GithubDown/openclaw/src/agents/pi-tool-definition-adapter.ts`
  - `/Users/admin/GitProjects/GithubDown/openclaw/src/agents/system-prompt.ts`
  - `/Users/admin/GitProjects/GithubDown/openclaw/src/agents/pi-embedded-runner/system-prompt.ts`
  - `/Users/admin/GitProjects/GithubDown/openclaw/src/agents/pi-embedded-subscribe.handlers.ts`
  - `/Users/admin/GitProjects/GithubDown/openclaw/src/agents/pi-embedded-subscribe.handlers.tools.ts`
- msgcode（现状）
  - `/Users/admin/GitProjects/msgcode/src/lmstudio.ts`
  - `/Users/admin/GitProjects/msgcode/src/providers/tool-loop.ts`
  - `/Users/admin/GitProjects/msgcode/src/tools/bus.ts`
  - `/Users/admin/GitProjects/msgcode/src/routes/cmd-model.ts`
  - `/Users/admin/GitProjects/msgcode/src/config/workspace.ts`
  - `/Users/admin/GitProjects/msgcode/src/handlers.ts`

## 核心结论（先给结论）

1. `msgcode` 已完成关键止血（根路径、失败短路、基础观测），但“工具循环单一真相源”仍未达成。  
2. 目前同时存在两套 ToolLoop 入口（`lmstudio.ts` 与 `providers/tool-loop.ts`），且后者仍写死 `process.cwd()`，这是下一次漂移隐患。  
3. 供应商切换现在是“runner 级切换”，不是“provider 协议层切换”；可用但扩展成本高。  
4. skill 当前主要靠 system 文本提示“read_file + bash”触发，且 `run_skill` 仍在 Tool Bus，存在语义双轨。  
5. 提示词注入现在是字符串拼接，缺少“分段/预算/冲突优先级”机制，后续会放大注入口径漂移。

## 三方对照

| 维度 | pi-mono | openclaw | msgcode 现状 | 结论 |
|---|---|---|---|---|
| ToolLoop 主链 | 明确事件循环，`tool_execution_start/update/end`（`agent-loop.ts:310`） | 在 pi 基础上加策略/钩子/订阅观测 | 主链在 `lmstudio.ts`，另有一份 `providers/tool-loop.ts` | 需要收敛为单入口 |
| 参数契约 | `validateToolArguments`（`agent-loop.ts:322`） | `before_tool_call` + `after_tool_call` 包装（`pi-tool-definition-adapter.ts:104`） | 主要靠运行时报错，缺强校验 | 需要工具参数 schema 化 |
| 供应商兼容 | `transformMessages` 归一化 toolCallId/补 orphan 结果（`transform-messages.ts:93`） | provider 策略+profile+group 多层过滤 | `cmd-model` 只放开 `lmstudio/codex/claude-code`，`openai/claude/llama` 仅 planned | 可运行，但不是可扩展形态 |
| Prompt 注入 | tools+guidelines+skills 结构化拼装（`system-prompt.ts:98`） | `PromptMode + runtimeInfo + toolSummaries` 分段注入（`system-prompt.ts:15`） | `lmstudio.ts` 中直接拼接 skill/SOUL/summary/window | 需要 PromptAssembler |
| Skill 触发 | skill 与 tools 同一系统提示约束 | skills section + tool hints 协作 | skillHint 文本提示 + `run_skill` 工具并存 | 需统一执行口径 |

## 四个问题的详细诊断

### 1) 模型工具调用是否正确

正向证据（已具备）：

- 标准 `tool_calls` 主路径已建立：`/Users/admin/GitProjects/msgcode/src/lmstudio.ts:1351`。
- 工具失败短路已落地：`/Users/admin/GitProjects/msgcode/src/lmstudio.ts:1388`。
- 工具观测字段已补全：`/Users/admin/GitProjects/msgcode/src/lmstudio.ts:1463`。

风险证据（仍在）：

- 第二套 ToolLoop 仍执行 `workspacePath: process.cwd()`：`/Users/admin/GitProjects/msgcode/src/providers/tool-loop.ts:195`。
- 同时维护两份循环实现，后续修一处漏一处概率高。

结论：

- 当前“可用”，但未达“可证明正确”。  
- 必须先完成 ToolLoop 单一真相源，才能进入下一阶段功能扩展。

### 2) 供应商能否稳定切换

现状证据：

- `workspace` 类型定义包含 `lmstudio/llama/claude/openai/codex/claude-code`：`/Users/admin/GitProjects/msgcode/src/config/workspace.ts:46`。
- 命令面仅允许 `lmstudio/codex/claude-code`，其余是 planned：`/Users/admin/GitProjects/msgcode/src/routes/cmd-model.ts:64`。

对照：

- pi-mono 在 provider 层做消息归一化和兼容修正（`transform-messages.ts:11`）。
- openclaw 在工具策略上还有 provider 维度策略管线（`tool-policy-pipeline.ts:17`）。

结论：

- 目前是“执行臂切换”，不是“协议适配层切换”。  
- 若后续要真开 `openai/claude/llama`，需要先补 provider adapter contract（请求构建、响应归一、toolCall id 归一）。

### 3) 模型能否通过读取 skill 展开工具并交付

现状证据：

- skill 通过 system 文本注入“读取技能文件 + bash 执行”：`/Users/admin/GitProjects/msgcode/src/lmstudio.ts:1278`。
- Tool Bus 仍保留 `run_skill`：`/Users/admin/GitProjects/msgcode/src/tools/bus.ts:32` 与 `:469`。

风险：

- 一条路径是“模型自行 read_file + bash”，另一条路径是“run_skill 工具”(应该废弃)，语义双轨。
- 双轨会导致：日志口径不一、验收口径不一、权限策略分裂。

结论：

- 要么保留 `run_skill` 并收敛为唯一 skill 执行器；要么彻底删除并锁死“read_file + bash”模式。  
- 不能长期双轨。

### 4) 提示词注入（工具信息）如何设计

现状证据：

- `lmstudio.ts` 内混合拼接 skill/SOUL/summary/window：`/Users/admin/GitProjects/msgcode/src/lmstudio.ts:1240-1330`。

对照：

- pi-mono：system prompt 有明确工具列表与指导语分区（`system-prompt.ts:98`）。
- openclaw：支持 `PromptMode`、`runtimeInfo`、`toolSummaries` 分段注入（`system-prompt.ts:15`、`:176`、`:349`）。

结论：

- 建议引入 `PromptAssembler`：把工具提示、SOUL、记忆、运行时信息拆段并设预算上限；  
- 禁止在主流程继续“任意字符串追加”。

## 设计决策建议（冻结）

1. `ToolLoop` 单一真相源：只保留 `runLmStudioToolLoop`，`providers/tool-loop.ts` 退场或只保留纯函数工具。  
2. `ProviderAdapter` 先立契约再扩 provider：`buildRequest / parseResponse / normalizeToolCalls`。  
3. `Skill` 单轨执行：本阶段保留 `run_skill`（可观测更稳），并让自然语言触发也走同一执行器。  
4. `PromptAssembler` 分段注入：`core/tooling/soul/memory/runtime` 五段，按预算截断，统一日志字段。  

## 建议下一单（可直接派发）

## P5.6.13-R1A-EXEC：Tool Calling 收口与契约锁

目标：

1. 清除 ToolLoop 双实现漂移。
2. 固化 provider adapter contract（不新增 provider，只立边界）。
3. 固化 skill 单轨执行器。
4. 引入 PromptAssembler（只做搬运收口，不改语义文案）。

范围：

- `/Users/admin/GitProjects/msgcode/src/lmstudio.ts`
- `/Users/admin/GitProjects/msgcode/src/providers/tool-loop.ts`
- `/Users/admin/GitProjects/msgcode/src/providers/openai-compat-adapter.ts`
- `/Users/admin/GitProjects/msgcode/src/tools/bus.ts`
- `/Users/admin/GitProjects/msgcode/src/handlers.ts`
- `/Users/admin/GitProjects/msgcode/test/*tool*`
- `/Users/admin/GitProjects/msgcode/test/*skill*`
- `/Users/admin/GitProjects/msgcode/test/*provider*`

硬验收：

- `npx tsc --noEmit`
- `npm test`（0 fail，且无新增 `.only/.skip`）
- `npm run docs:check`
- 回归锁新增（至少）：
  - ToolLoop 单入口锁（禁止 `process.cwd()` 漂移）
  - skill 单轨锁（自然语言和命令入口同执行器）
  - prompt 组装锁（包含 tools/soul/memory/runtime 片段）
  - provider contract 锁（request/response/tool_calls 归一）

## 备注

- 本文档是“开单前设计审计”，不直接替代实施任务单。  
- 若签收本调研，下一步按上面的 `P5.6.13-R1A-EXEC` 直接开工最稳。
