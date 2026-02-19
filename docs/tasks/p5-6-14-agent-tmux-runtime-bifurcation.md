# 任务单：P5.6.14（运行臂二分：agent / tmux）

优先级：P0（运行时架构收口）

## 目标（冻结）

1. 运行时只保留两种执行形态：`agent` 与 `tmux`。
2. `agent` 形态统一承载智能编排：SOUL 注入、工具注入、记忆注入、Prompt 组装、ToolLoop。
3. `tmux` 形态只做忠实转发：不做 SOUL/记忆/工具注入，不做二次编排。
4. provider 从“运行臂”中下沉为 `agent` 子配置：`lmstudio / minimax / openai / ...`。
5. 不改变用户可见语义：命令面保持稳定，先跑通再扩工具面。

## 决策锁定（C兄已确认）

1. 默认形态：`runtime.kind=agent`。
2. `tmux` 侧切换维度是 `client`（`codex|claude-code`），不是 provider。
3. 首批 `agent.provider`：`lmstudio|minimax|openai`。
4. `policy.mode` 仅约束 `agent` 外联；`tmux` 不受其 provider 门禁影响。
5. SOUL/记忆/工具注入仅在 `agent` 生效；`tmux` 永远禁注入。
6. `/model` 命令保留（不改名），仅调整其底层读写语义。
7. 兼容窗口：`v2.3.x` 保留 `runner.default` 只读映射；`v2.4.0` 硬切移除主判定。

## 背景（问题本质）

当前配置把 `lmstudio/codex/claude-code/...` 混合在 `runner.default`，导致“执行形态”和“模型供应商”耦合，产生三类坏味道：

1. 轻微配置改动牵动路由、注入、工具门禁连锁变化（僵化）。
2. 同一注入逻辑在 direct/tmux 多处分支重复（冗余）。
3. provider 扩展成本高，每加一个 provider 都要改路由分支（脆弱）。

## 设计口径（单一真相）

### 1) 运行形态（Runtime Kind）

- `agent`：智能体执行形态（有上下文编排）
- `tmux`：透传执行形态（无上下文编排）

### 2) provider（仅 agent 下）

- `agent.provider`: `lmstudio | minimax | openai | ...`
- provider 只影响 `agent` 内部模型调用，不参与顶层路由分支判断。

### 2.1) tmux client（仅 tmux 下）

- `tmux.client`: `codex | claude-code`
- 只影响透传目标客户端，不触发任何注入逻辑。

### 3) 规则

1. 是否注入 SOUL/记忆/工具，只看 `runtime.kind`，不看 provider。
2. `tmux` 永远不做注入，保持“收什么转什么”。
3. `agent` 统一通过同一编排入口调用 provider adapter。

## 建议配置模型（实施目标）

```json
{
  "runtime.kind": "agent",
  "agent.provider": "lmstudio",
  "tmux.client": "codex",
  "policy.mode": "local-only|egress-allowed",
  "pi.enabled": true
}
```

兼容期（迁移桥）：

- 读取旧配置 `runner.default` 并映射：
  - `codex|claude-code` -> `runtime.kind=tmux` + `tmux.client=<runner>`
  - `lmstudio|openai` -> `runtime.kind=agent` + `agent.provider=<runner>`
  - `llama|claude` -> `runtime.kind=agent` + `agent.provider=lmstudio`（兼容降级并打 warn）
- 写回时优先写新字段；旧字段只读不再作为主判定。

## 实施范围

- `/Users/admin/GitProjects/msgcode/src/config/workspace.ts`
- `/Users/admin/GitProjects/msgcode/src/routes/cmd-model.ts`
- `/Users/admin/GitProjects/msgcode/src/handlers.ts`
- `/Users/admin/GitProjects/msgcode/src/router.ts`（必要时）
- `/Users/admin/GitProjects/msgcode/src/providers/*`（仅 agent 侧接线）
- `/Users/admin/GitProjects/msgcode/test/*model*`
- `/Users/admin/GitProjects/msgcode/test/*handlers*`
- `/Users/admin/GitProjects/msgcode/test/*runtime*`
- `/Users/admin/GitProjects/msgcode/docs/tasks/README.md`（索引同步）

## 非范围

- 不新增工具（grep/find/ls 等后置）。
- 不改记忆检索策略（sqlite-vec 现状保持）。
- 不做 UI/文案大改。
- 不在本单引入新命令族。

## 执行步骤

### R1：配置域二分（Kind/Provider）

1. 增加新配置键：`runtime.kind`、`agent.provider`、`tmux.client`。
2. 提供 `runner.default -> kind/provider/client` 兼容映射函数。
3. 新增读取 API：`getRuntimeKind()`、`getAgentProvider()`、`getTmuxClient()`；旧 `getDefaultRunner()` 进入兼容层。

### R2：路由收口（先 Kind 再 Provider）

1. `handlers` 顶层只按 `runtime.kind` 分流：
   - `agent` -> 智能体链路
   - `tmux` -> 透传链路
2. `agent` 内部再按 `agent.provider` 调用对应 adapter。
3. 删除“按 runner 名称分支注入逻辑”的重复分支。

### R3：注入职责硬边界

1. `agent`：保留 SOUL/记忆/工具/Prompt 注入。
2. `tmux`：显式禁止上述注入（防回流断言）。
3. 日志补全字段：`runtimeKind`、`agentProvider`。

### R4：命令面兼容（不改用户习惯）

1. `/model` 继续可用，但底层改为读写 `agent.provider`（当 kind=agent）。
2. 当 kind=tmux，`/model` 返回“当前为 tmux 透传模式（client=codex|claude-code），provider 不参与执行”。
3. `/policy` 口径保持不变。
4. `/model codex|claude-code` 映射为 `runtime.kind=tmux + tmux.client=<model>`（兼容旧习惯）。

### R5：回归锁

1. `agent` 路径必须出现注入字段。
2. `tmux` 路径必须不出现注入字段。
3. provider 切换仅影响 `agent` 内调用，不影响 `tmux` 行为。
4. 禁止新增 `.only/.skip`。

### R6：日志最佳实践（本单强制）

所有请求开始/结束日志必须包含：

- `runtimeKind`（`agent|tmux`）
- `agentProvider`（`lmstudio|minimax|openai|none`）
- `tmuxClient`（`codex|claude-code|none`）
- `injectionEnabled`（布尔）
- `traceId`

其中：

1. `agent`：`injectionEnabled=true`，并保留 `soulInjected/memory...` 细项。
2. `tmux`：`injectionEnabled=false`，且 `soulInjected/memory...` 不得出现非零注入。

## 硬验收（必须全过）

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`
4. 冒烟：
   - `runtime.kind=agent` 时，日志含 `soulInjected` / `memory...` / `runtimeKind=agent`
   - `runtime.kind=tmux` 时，不注入 SOUL/记忆，且日志 `runtimeKind=tmux` + `injectionEnabled=false`
5. 静态锁：
   - `rg -n "currentRunner === \\\"codex\\\"|currentRunner === \\\"claude-code\\\"" src/handlers.ts` 结果为 0（迁移完成后）
   - `rg -n "runner\\.default\\s*\\?" src/config src/handlers src/routes` 仅允许兼容映射层命中
   - `rg -n "it\\.skip|describe\\.skip|test\\.skip|\\.only\\(" test` 结果为 0

## 提交纪律

1. 禁止 `git add -A`。
2. 至少 4 提交：
   - `runtime-kind-provider-config`
   - `handler-kind-routing`
   - `tmux-no-injection-guard`
   - `compat-cmd-model+tests`
3. 单次提交变更文件数 > 20 直接拆分重做。

## 验收回传模板

```md
# P5.6.14 验收报告（agent/tmux 二分）

## 提交
- <sha> <message>

## 变更文件
- <path>

## Gate
- npx tsc --noEmit:
- npm test:
- npm run docs:check:

## 关键证据
- runtime.kind=agent 注入证据:
- runtime.kind=tmux 透传证据:
- provider 切换证据:

## 风险与遗留
- 风险:
- 遗留:
```
