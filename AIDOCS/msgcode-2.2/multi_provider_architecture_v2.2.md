# Multi-Provider Architecture（v2.2）

> 目标：统一三层类型定义，实现多供应商自由切换。
>
> 原则：**配置层稳定**、**运行时隔离**、**供应商可插拔**。

---

## 一句话总结

```
Config (用户配置) → Runtime (运行时分类) → Provider (实际供应商)
  "mlx"   ──────→   "direct"   ──────→  MLXProvider (model: "glm-4.7-flash")
  "codex" ──────→   "tmux"     ──────→  CodexSession (tmux 管理)
```

---

## 问题现状

### 当前三层类型不一致

| 层级 | 文件 | 类型定义 | 问题 |
|------|------|----------|------|
| **Config** | `src/config/workspace.ts:44` | `"lmstudio" \| "codex" \| "claude-code" \| "mlx"` | 缺少 "claude"/"openai"，与 TMUX 层不一致 |
| **Runtime** | `src/tmux/session.ts:24` | `"claude" \| "codex" \| "claude-code" \| "local"` | 语义混乱：claude 不是 tmux，local 包含远程 API |
| **Provider** | `src/capabilities.ts:43` | `"mlx" \| "lmstudio" \| "codex" \| "claude-code"` | 注意：这是能力/预算类型，不是 provider registry |

**导致的 Bug**：
- `handlers.ts:116` 比较 `r === "claude"` 时 TypeScript 报错：类型不重叠
- `resolveRunner` 逻辑无法正确识别非 tmux runners

---

## 现状 vs 目标

| 项 | 现状 | 目标 | 状态 |
|------|------|------|------|
| **Config RunnerConfig** | `"lmstudio" \| "codex" \| "claude-code" \| "mlx"` | `"mlx" \| "lmstudio" \| "llama" \| "claude" \| "openai" \| "codex" \| "claude-code"` | 🔴 P0 |
| **Runtime RunnerType** | `"claude" \| "codex" \| "claude-code" \| "local"` | `"tmux" \| "direct"` | 🔴 P0 |
| **Provider 实现状态** | `src/providers/mlx.ts` ✅<br>`src/lmstudio.ts` ✅ | `src/providers/llama.ts` 📋<br>`src/providers/claude.ts` 📋<br>`src/providers/openai.ts` 📋 | 🟡 P1 |
| **MLX 模型切换** | 需重启配置 | 动态切换 + 验证 | 🟡 P1 |

> **重要提示**：
> - `RunnerType` (session.ts:24) 和 `RunnerConfig` (workspace.ts:44) **仍为旧值**，迁移未落地。
> - `resolveRunner` (handlers.ts:116) 仍把 `claude` 当作 tmux runner。
> - `RunnerConfig` 目标包含 `"llama"`，但 workspace.ts 当前还未包含此值。
> - 本文档描述的是**目标架构**，实施清单见后文。

---

## 架构设计

### 三层职责划分

```
┌─────────────────────────────────────────────────────────────────┐
│  Layer 1: Config Layer (配置层)                                 │
│  职责：用户可见的配置选项，稳定不变                              │
│  位置：src/config/workspace.ts                                  │
├─────────────────────────────────────────────────────────────────┤
│  RunnerConfig =                                                 │
│    | 本地 Providers (本地模型运行，direct 调用)                  │
│    |   "mlx"        - MLX LM Server ✅ (direct)                  │
│    |   "lmstudio"   - LM Studio ✅ (direct, 兼容保留)            │
│    |   "llama"      - llama-server / llama.cpp 📋 (gguf, direct) │
│    |                                                               │
│    | 远程 API Providers (直连 API，不走 tmux)                     │
│    |   "claude"     - Anthropic Claude API 📋 (planned)          │
│    |   "openai"     - OpenAI Chat API 📋 (planned, 非 tmux)       │
│    |                                                               │
│    | TMUX Runners (tmux 会话管理)                                 │
│    |   "codex"      - OpenAI Codex CLI ✅ (tmux)                   │
│    |   "claude-code"- Claude Code CLI ✅ (tmux)                   │
│                                                               │
│  说明：                                                             │
│  - codex = OpenAI Codex CLI（经 tmux 执行臂，已实现）             │
│  - openai = OpenAI Chat API（不走 tmux，计划中）                     │
│  - claude-code = Claude Code CLI（经 tmux 执行臂，已实现）         │
│  - claude = Claude API（不走 tmux，计划中）                           │
│  - mlx/lmstudio = 本地直连（已实现）                                 │
│  - llama = llama-server gguf（计划中）                               │
└─────────────────────────────────────────────────────────────────┘
                              ↓ 映射
┌─────────────────────────────────────────────────────────────────┐
│  Layer 2: Runtime Layer (运行时层)                              │
│  职责：执行臂路由判断，tmux vs direct                           │
│  位置：src/tmux/session.ts, src/handlers.ts                      │
├─────────────────────────────────────────────────────────────────┤
│  RunnerType =                                                   │
│    | "tmux"   - 需要 tmux 会话管理 (codex, claude-code)         │
│    | "direct" - 直连调用 (mlx, lmstudio, claude, openai, llama) │
└─────────────────────────────────────────────────────────────────┘
                              ↓ 映射
┌─────────────────────────────────────────────────────────────────┐
│  Layer 3: Provider Layer (供应商层)                             │
│  职责：具体模型调用实现                                          │
│  位置：src/providers/, src/lmstudio.ts                           │
├─────────────────────────────────────────────────────────────────┤
│  ProviderType =                                                 │
│    | "mlx"        ✅ - MLX LM Server (src/providers/mlx.ts)     │
│    | "lmstudio"   ✅ - LM Studio (src/lmstudio.ts)              │
│    | "llama"      📋 - llama-server / llama.cpp (gguf)          │
│    | "claude"     📋 - Claude API (planned, 不走 tmux)           │
│    | "openai"     📋 - OpenAI Chat API (planned, 不走 tmux)      │
│                                                               │
│  模型配置（每个 provider 可配置不同模型）：                       │
│    | MLX:        modelId = "glm-4.7-flash" | "qwen-72b"        │
│    | LMStudio:   modelId = "custom-model-id"                    │
│    | Llama:      modelPath = "*.gguf" (文件路径)               │
│    | Claude:     modelId = "claude-opus-4" | "claude-3.5-sonnet"│
│    | OpenAI:     modelId = "gpt-4" | "o1"                       │
│    | Llama:      modelId = "*.gguf" (llama-server)              │
│    | Claude:     modelId = "claude-opus-4" | "claude-3-5-sonnet"│
│    | OpenAI:     modelId = "gpt-4" | "o1"                       │
└─────────────────────────────────────────────────────────────────┘

图例：✅ 已实现 | 📋 计划中

说明：
- MLX: 新架构，统一 provider 接口
- LMStudio: 兼容保留，现有实现在 src/lmstudio.ts（根目录）
- Llama: 计划中，用于 *.gguf 裸模型（llama-server / llama.cpp）
```

---

## 映射规则

> **注意**：以下代码为**目标实现示意**，当前代码（handlers.ts:108-129）仍使用旧逻辑。

### Config → Runtime 映射（🎯 目标代码）

```typescript
// handlers.ts: resolveRunner() - 目标实现
const resolveRunner = async (): Promise<"tmux" | "direct"> => {
    const config = await getDefaultRunner(projectDir);

    // TMUX Runners（需要会话管理）
    if (config === "codex" || config === "claude-code") {
        return "tmux";
    }

    // Direct 调用（本地模型 + 远程 API）
    // mlx, lmstudio, llama, claude, openai → direct
    return "direct";
};
```

### Runtime → Provider 映射（🎯 目标代码）

```typescript
// handlers.ts: 调用 provider 时
const runner = await resolveRunner();
if (runner === "direct") {
    const config = await getDefaultRunner(projectDir);
    // 根据配置选择具体 provider
    switch (config) {
        case "mlx": return new MLXProvider(...);
        case "lmstudio": return new LMStudioProvider(...);
        case "claude": return new ClaudeProvider(...);   // 📋 planned
        case "openai": return new OpenAIProvider(...);   // 📋 planned
    }
} else if (runner === "tmux") {
    // 处理 tmux runners (codex, claude-code)
    return createTmuxSession(config);
}
```

---

## 模型配置规范

### MLX 模型配置

**配置位置**：`<WORKSPACE>/.msgcode/config.json`

```json
{
  "runner.default": "mlx",
  "mlx.modelId": "huihui-glm-4.7-flash-abliterated-mlx",
  "mlx.baseUrl": "http://127.0.0.1:18000",
  "mlx.maxTokens": 2048,
  "mlx.temperature": 0.7,
  "mlx.topP": 1.0
}
```

> **注意**：`mlx.maxTokens` 默认已提升到 `2048`（Unsloth 稳态参数），用于降低"空回复/finish_reason=length"概率。

**支持的模型值**：
- `huihui-glm-4.7-flash-abliterated-mlx` - GLM-4.7 Flash
- `qwen-72b` - Qwen 72B
- 其他 MLX server `/v1/models` 返回的模型 ID

### Llama-server 配置（📋 planned）

```json
{
  "runner.default": "llama",
  "llama.modelPath": "path/to/model.gguf",
  "llama.baseUrl": "http://127.0.0.1:8080",
  "llama.contextSize": 8192
}
```

**字段说明**：
- `llama.modelPath`：gguf 文件路径（绝对路径或相对于 `MODEL_ROOT`）
- 与 MLX/LMStudio 不同：llama 用 `modelPath` 而非 `modelId`，因为语义是"文件路径"而非"模型标识符"

**支持的模型值**：
- 任何 `*.gguf` 格式的模型文件
- 例如：`llama-2-13b.Q4_K_M.gguf`、`mistral-7b-instruct-v0.2.Q8_0.gguf`

**前置依赖**：
- 启动 llama-server：`llama-server --model path/to/model.gguf --port 8080`
- 或使用 llama.cpp：`./llama-cli --model path/to/model.gguf --port 8080`

### Claude API 配置（📋 planned）

```json
{
  "runner.default": "claude",
  "claude.modelId": "claude-opus-4",
  "claude.apiKey": "${ANTHROPIC_API_KEY}"
}
```

### OpenAI API 配置（📋 planned）

```json
{
  "runner.default": "openai",
  "openai.modelId": "gpt-4",
  "openai.apiKey": "${OPENAI_API_KEY}"
}
```

### Codex TMUX 配置

```json
{
  "runner.default": "codex"
}
```

---

## 类型定义

### Config Layer

```typescript
// src/config/workspace.ts
export type RunnerConfig =
  // 本地 Providers
  | "mlx"        // MLX LM Server (推荐，支持工具调用) ✅
  | "lmstudio"   // LM Studio (兼容保留) ✅
  | "llama"      // llama-server / llama.cpp 📋 (gguf)
  // 远程 API Providers
  | "claude"     // Anthropic Claude API 📋 (planned)
  | "openai"     // OpenAI API (GPT-4, o1, etc.) 📋 (planned)
  // TMUX Runners
  | "codex"      // OpenAI Codex (tmux) ✅
  | "claude-code";// Claude Code CLI (tmux) ✅;

export interface WorkspaceConfig {
  "runner.default"?: RunnerConfig;
  // ... 其他配置
}
```

### Runtime Layer

```typescript
// src/tmux/session.ts
export type RunnerType =
  | "tmux"    // TMUX runners (codex, claude-code)
  | "direct"; // 直连调用 (mlx, lmstudio, llama, claude, openai)

export interface SessionRecord {
  sessionName: string;
  groupName: string;
  projectDir?: string;
  runner: RunnerType;  // 更新为 "tmux" | "direct"
  createdAtMs: number;
  updatedAtMs: number;
  lastStartAtMs: number;
  lastStopAtMs: number;
}
```

### Provider Layer

```typescript
// src/providers/index.ts (新建)
export type ProviderType =
  | "mlx"        // MLX LM Server ✅
  | "lmstudio"   // LM Studio ✅
  | "llama"      // llama-server / llama.cpp 📋 (gguf)
  | "claude"     // Claude API 📋 (planned)
  | "openai";    // OpenAI API 📋 (planned)

export interface ProviderConfig {
  type: ProviderType;
  modelId: string;
  baseUrl?: string;
  apiKey?: string;
  // ... 其他 provider 特定配置
}

// Provider 实现状态映射
export const PROVIDER_STATUS: Record<ProviderType, "ready" | "planned"> = {
    mlx: "ready",
    lmstudio: "ready",
    llama: "planned",
    claude: "planned",
    openai: "planned",
};
```

---

## 实施清单

### Phase 1: 类型定义统一（P0 🔴）

- [ ] 更新 `src/config/workspace.ts` 的 `RunnerConfig` 类型
- [ ] 更新 `src/tmux/session.ts` 的 `RunnerType` 为 `"tmux" | "direct"`
- [ ] 更新 `src/tmux/registry.ts` 的 `SessionRecord.runner` 类型
- [ ] 创建 `src/providers/index.ts` 统一 Provider 类型

### Phase 2: 映射逻辑修复（P0 🔴）

- [ ] 修复 `src/handlers.ts` 的 `resolveRunner()` 函数
- [ ] 添加 Runtime → Provider 的映射逻辑
- [ ] 确保 TMUX runners 正确识别为 `"tmux"`

### Phase 3: MLX 模型配置（P1 🟡）

- [ ] 确保 MLX provider 支持从配置读取 `modelId`
- [ ] 支持动态模型切换（无需重启）
- [ ] 添加模型验证（调用 `/v1/models` 检查）

### Phase 4: Provider 扩展（P1 🟡 planned）

- [ ] 实现 `src/providers/llama.ts` (llama-server / llama.cpp)
- [ ] 实现 `src/providers/claude.ts`
- [ ] 实现 `src/providers/openai.ts`

### Phase 5: 文档更新（P0 🔴）

- [ ] 更新 `AIDOCS/msgcode-2.2/README.md` 的配置说明
- [ ] 更新 `AIDOCS/msgcode-2.1/model_routing_spec_v2.1.md` 的路由规范
- [ ] 添加 `/model` 命令的帮助文本

---

## 迁移步骤

### Step 1: 类型定义更新（P0）

1. 更新 `RunnerConfig` 类型，添加 "claude" | "openai"
2. 更新 `RunnerType` 类型，改为 "tmux" | "direct"
3. 更新所有引用这些类型的地方

### Step 2: 映射逻辑修复（P0）

1. 修改 `resolveRunner()` 函数
2. 更新 TMUX session 创建逻辑
3. 确保 registry 正确存储 runner type

### Step 3: 向后兼容处理（P0）

1. 读取 registry 时兼容旧的 runner 类型值
2. 自动迁移旧数据到新类型
3. 添加日志记录迁移过程

### Step 4: MLX 模型切换（P1）

1. 添加 `/model` 命令支持模型参数
2. 实现动态模型切换
3. 添加模型验证逻辑

---

## 兼容策略

### 旧配置自动映射

| 旧 RunnerType | 新 RunnerType | 说明 |
|---------------|---------------|------|
| `"claude"` | `"direct"` | Claude API 不是 tmux |
| `"codex"` | `"tmux"` | Codex 是 tmux runner |
| `"claude-code"` | `"tmux"` | Claude Code 是 tmux runner |
| `"local"` | `"direct"` | 本地/直连统一为 direct |

### Registry 数据迁移

```typescript
// registry 读取时自动迁移
function migrateRunnerType(oldType: string): RunnerType {
    const mapping: Record<string, RunnerType> = {
        "claude": "direct",
        "codex": "tmux",
        "claude-code": "tmux",
        "local": "direct",
        "mlx": "direct",
        "lmstudio": "direct",
        "llama": "direct",
    };
    return mapping[oldType] ?? "direct";
}
```

### 配置验证（📋 planned）

```bash
# 升级后自动检查配置（命令计划中）
msgcode doctor --check-runner-config
```

**当前验证方式**：
```bash
# 手动检查配置文件
cat ~/msgcode-workspaces/your-workspace/.msgcode/config.json

# 查看 runner 配置
grep "runner.default" ~/msgcode-workspaces/your-workspace/.msgcode/config.json
```

---

## 示例场景

### 场景 1：切换到 GLM-4.7-Flash

```bash
# 查看当前模型
/model

# 切换到 MLX + GLM-4.7
/model mlx

# 验证
/status
```

配置文件：
```json
{
  "runner.default": "mlx",
  "mlx.modelId": "huihui-glm-4.7-flash-abliterated-mlx"
}
```

### 场景 2：切换模型（MLX）

**当前方式（✅ 可用）**：
```bash
# 1. 编辑配置文件
vim ~/msgcode-workspaces/your-workspace/.msgcode/config.json

# 2. 修改 mlx.modelId
{
  "runner.default": "mlx",
  "mlx.modelId": "qwen-72b"
}

# 3. 重载配置
/reload

# 4. 验证
/status
```

**未来方式（📋 planned）**：
```bash
# 切换到 Qwen（一行命令）
/model mlx --model-id qwen-72b

# 验证模型可用性
/model mlx --verify
```

### 场景 3：切换到 Codex (TMUX)

```bash
/model codex
```

配置文件：
```json
{
  "runner.default": "codex"
}
```

### 场景 4：切换到 Claude API（📋 planned - Provider 未实现）

> **注意**：Claude Provider (`src/providers/claude.ts`) 尚未实现，此场景为规划中的功能。

**未来方式（📋 planned）**：
```bash
/model claude --model-id claude-opus-4
```

配置文件：
```json
{
  "runner.default": "claude",
  "claude.modelId": "claude-opus-4"
}
```

**前置依赖**：
- [ ] 实现 `src/providers/claude.ts`
- [ ] 更新 `RunnerConfig` 类型包含 "claude"
- [ ] 实现 Claude API 调用逻辑

---

## 开发规范（防止复发）

### ⚠️ Slash 命令单一真相源规则

**核心原则**：`/start /stop /status /snapshot /esc /clear` 等 tmux 会话管理命令**只能在 BaseHandler 定义**，禁止在其他 Handler 重复实现。

**理由**：
1. **避免双入口漂移**：重复实现会导致"改一处漏一处"的维护风险
2. **统一 gate 逻辑**：tmux/direct 执行臂的判断逻辑集中在 `resolveRunner()`
3. **降低回归风险**：修改 slash 命令行为只需维护一处代码

**当前架构**（v2.2 已落地）：
- `BaseHandler.handle()` (handlers.ts:102-277)：**唯一的 slash 命令真相源**
  - `resolveRunner()` (line 108-132)：执行臂解析逻辑
  - `/start /stop /status /snapshot /esc /clear` (line 136-241)：统一 gate
- `RuntimeRouterHandler.handle()` (handlers.ts:397-413)：
  - Slash 命令代理到 `new DefaultHandler().handle()` (line 402-404)
  - 非 slash 命令走独立消息路由 (line 405-410)

**守卫测试**：`test/handlers.tmux-gate.test.ts` 的"守卫 #9"验证此规则

**违规示例**（禁止）：
```typescript
// ❌ 错误：在其他 Handler 重复实现 /start
export class SomeHandler implements CommandHandler {
    async handle(message: string, context: HandlerContext): Promise<HandleResult> {
        if (trimmed === "/start") {
            // 不要这样做！应该代理到 DefaultHandler
        }
    }
}
```

**正确实现**：
```typescript
// ✅ 正确：代理到 DefaultHandler（BaseHandler）
export class RuntimeRouterHandler implements CommandHandler {
    async handle(message: string, context: HandlerContext): Promise<HandleResult> {
        const trimmed = message.trim();

        // Slash 命令代理到 DefaultHandler（使用 BaseHandler 的统一逻辑）
        if (trimmed.startsWith("/")) {
            return new DefaultHandler().handle(message, context);
        }

        // 非 slash 命令走独立路由
        // ...
    }
}
```

---

## 参考资料

- [Model Routing Spec v2.1](../msgcode-2.1/model_routing_spec_v2.1.md)
- [Local Runners Spec v2.1](../msgcode-2.1/local_runners_spec_v2.1.md)
- [README v2.2](./README.md)
- [msgcode Issue Troubleshooting](../msgcode-issue-troubleshooting.md)
