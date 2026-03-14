# 任务单：P5.7-R8b（Agent Backend 语义收敛 + MiniMax 2.5 切换）

优先级：P1（R8 并行插单，优先打通后端切换）

## 目标（冻结）

1. 统一语义：用户面与配置面不再使用 `lmstudio` 作为执行后端名，统一为 `agent-backend`（或 `agent`）。
2. 接入可切换后端：在不改业务路由的前提下，支持 `local-openai` 与 `minimax` 后端切换。
3. 支持 MiniMax 2.5 试运行：可通过配置切到 MiniMax 2.5 模型完成 no-tool/tool 两类链路。
4. 保持兼容：旧配置（`lmstudio`/`LMSTUDIO_*`）可读可用，但对外展示统一为 `agent-backend` 语义。

## 现状证据（必须先承认问题）

1. `src/handlers.ts` 目前无论 provider 值是什么，主链都固定调用 `runLmStudioRoutedChat`。
2. `src/routes/cmd-model.ts` 仅允许 `lmstudio|openai`，`minimax` 仍是 planned。
3. `src/config/workspace.ts` 已有 `agent.provider=minimax` 类型，但兼容映射仍大量回落到 `lmstudio`。
4. `src/router.ts` / `src/routes/cmd-bind.ts` / `src/listener.ts` 仍把 `lmstudio` 当 botType 主标识。
5. `src/providers/openai-compat-adapter.ts` 鉴权字段仍固定读取 `config.lmstudioApiKey`，无法表达通用后端凭证。

结论：当前是“显示可切换，执行未切换”的假开关，先做语义与执行双收口。

## 设计原则（冻结）

1. Everything is a file：配置与提示词均文件化，运行时只读配置，不在代码里硬编码后端策略。
2. 单一入口：业务层只调用 `runAgentRoutedChat`，不直接依赖具体后端模块。
3. 兼容先行：先做 alias + 适配层，再做彻底改名，避免一次性大爆炸。
4. 行为优先：回归锁只测“能否切换并生效”，不测源码字符串。

## 架构方案（最小可落地）

### 1. 命名语义收敛

1. 用户面（命令回执、日志字段、help-docs）统一用 `agent-backend`。
2. 内部过渡期允许别名映射：
   - `lmstudio` -> `local-openai`
   - `agent-backend` -> `local-openai`
   - `minimax` -> `minimax`
   - `openai` -> `openai`

### 2. 后端适配层

新增目录建议：`src/agent-backends/`

1. `types.ts`
   - `AgentBackendId = "local-openai" | "minimax" | "openai"`
   - `AgentBackendAdapter`（统一 `chat/toolLoop/listModels/health`）
2. `local-openai.ts`
   - 复用现有 LM Studio OpenAI 兼容调用能力
3. `minimax.ts`
   - MiniMax 2.5 专用适配（先覆盖 chat + tool-calls 必需字段）
4. `index.ts`
   - `getAgentBackendAdapter(id)` 工厂，统一别名归一化

### 3. 执行入口统一

1. 新增 `runAgentRoutedChat`（外部主入口）。
2. `runLmStudioRoutedChat` 降级为兼容 wrapper（内部转调 `runAgentRoutedChat`）。
3. `handlers.ts` 只读 `agent.backend` 并调用统一入口，不再直接绑定 `lmstudio.ts` 名称语义。

### 4. 配置合同（冻结）

Workspace config（`<workspace>/.msgcode/config.json`）：

1. 新增：`"agent.backend"?: "local-openai" | "minimax" | "openai"`
2. 保留：`"agent.provider"`（只读兼容，读到后映射到 `agent.backend`）
3. `model.executor` / `model.responder` 不变，继续作为模型名覆盖层。

Env config（`~/.config/msgcode/.env`）：

1. 新增通用键：
   - `AGENT_BACKEND`
   - `AGENT_BASE_URL`
   - `AGENT_MODEL`
   - `AGENT_API_KEY`
2. 兼容回退：若未设置 `AGENT_*`，继续读取 `LMSTUDIO_*`。
3. MiniMax 试运行建议：
   - `AGENT_BACKEND=minimax`
   - `AGENT_MODEL=<MiniMax 2.5 model id>`
   - `AGENT_API_KEY=<your key>`

## 执行步骤（每步一提交）

1. `feat(p5.7-r8b-1): add agent-backend alias and normalize provider naming`
2. `refactor(p5.7-r8b-2): introduce agent backend adapter layer`
3. `feat(p5.7-r8b-3): add minimax backend and wire model switch`
4. `test(p5.7-r8b-4): add backend-switch regression lock and smoke gate`
5. `docs(p5.7-r8b-5): sync help-docs and migration notes`

## 回归锁（冻结）

1. `/model minimax` 后，`runAgentRoutedChat` 必须命中 minimax adapter（行为断言）。
2. `/model agent-backend` 与 `/model lmstudio` 必须等价命中 `local-openai`。
3. no-tool/tool/complex-tool 三路均保留既有温度锁（0.2 / 0 / 0）。
4. 日志字段固定：`runtimeKind`, `agentBackend`, `route`, `phase`, `traceId`。
5. `help-docs --json` 必须暴露 `agent-backend` 语义，不再把 `lmstudio` 作为主名称。

## 错误码（新增冻结）

1. `AGENT_BACKEND_UNSUPPORTED`：未知后端。
2. `AGENT_BACKEND_AUTH_FAILED`：鉴权失败。
3. `AGENT_BACKEND_MODEL_NOT_FOUND`：模型不可用或未加载。
4. `AGENT_BACKEND_REQUEST_FAILED`：后端请求失败兜底。

## 验收门（必须全过）

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`
4. 本地真实切换证据：`local-openai -> minimax -> local-openai` 往返可用
5. 工具链路证据：`bash pwd` / `read_file` 至少一条真实成功
6. 无新增 `.only/.skip`

## 风险与回滚

1. 风险：MiniMax tool-calls 协议字段差异导致工具链路漂移。
2. 缓解：先打通 no-tool，再灰度开启 tool route；保留 `local-openai` 一键回退。
3. 回滚开关：`AGENT_BACKEND=local-openai` 或 `/model agent-backend`。

## 非范围

1. 不在本单重写 Tool Bus。
2. 不在本单移除 `src/lmstudio.ts`（仅降级为兼容层）。
3. 不在本单改 tmux 执行臂。
