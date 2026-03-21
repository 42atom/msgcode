# Codex CLI 子代理（线程）架构设计报告

## 1. 项目概述

**Codex CLI** 是 OpenAI 推出的本地编程 Agent 工具，使用 Rust 编写。其核心架构采用**线程化（Thread-based）子代理模型**，区别于传统进程隔离或容器化的子代理方案。

```
codex-rs/               # Rust 核心
├── core/               # 核心 Agent 逻辑
│   └── src/agent/      # Agent 生命周期与角色
│   └── src/tools/      # 工具实现（含 multi_agents）
├── protocol/           # 协议定义（SessionSource 等）
└── state/             # 状态管理（含线程持久化）

codex-cli/              # CLI 包装层
sdk/                    # SDK
```

---

## 2. 核心设计：线程化模型

### 2.1 为什么选择线程而非进程/容器

传统 Agent 子系统常采用进程或容器隔离（如 Docker），但 Codex 选择**协程/线程模型**，核心考量：

| 考量维度 | 进程/容器方案 | Codex 线程方案 |
|----------|-------------|----------------|
| 启动开销 | 数百毫秒~秒级 | 毫秒级 |
| 资源占用 | 每个子 Agent 独立进程 | 共享进程内存 |
| 通信开销 | IPC（管道/socket） | 直接内存引用 |
| 隔离性 | 强隔离 | 进程内隔离 |
| 适用场景 | 危险命令/恶意代码 | 协作分工 |

Codex 通过**进程级沙箱**（sandbox）作为独立安全层，而非依赖子代理隔离。

### 2.2 线程树结构

```
根线程 (root thread - 用户会话)
├── explorer thread (spawn_agent 创建)
│   └── [可选] 嵌套 explorer
├── worker thread (spawn_agent 创建)
└── 任意数量子线程 (受 max_depth 限制)
```

父子关系通过 `ThreadId` 追踪，形成有向树。

---

## 3. AgentControl：生命周期控制核心

### 3.1 核心数据结构

```rust
// codex-rs/core/src/agent/control.rs

pub(crate) struct AgentControl {
    manager: Weak<ThreadManagerState>,  // 弱引用全局线程注册表
    state: Arc<Guards>,                // 并发控制状态
}
```

使用 `Weak<ThreadManagerState>` 而非 `Arc`，是为了**避免循环引用**——ThreadManagerState 持有 AgentControl，而 AgentControl 又引用 ThreadManagerState。

### 3.2 核心方法

| 方法 | 职责 |
|------|------|
| `spawn_agent()` | 创建新 Agent 线程 |
| `spawn_agent_with_metadata()` | 带元数据的创建（路径/昵称/角色） |
| `send_input()` | 向指定 Agent 发送消息 |
| `interrupt_agent()` | 中断 Agent 执行 |
| `close_agent()` | 关闭 Agent |
| `get_status()` | 获取 Agent 当前状态 |
| `subscribe_status()` | 订阅状态变化（用于监视器） |

### 3.3 Agent 元数据

```rust
pub(crate) struct AgentMetadata {
    agent_id: Option<ThreadId>,       // 全局唯一线程 ID
    agent_path: Option<AgentPath>,    // 树路径，如 "root/explorer-1"
    agent_nickname: Option<String>,    // 显示名，如 "Arthur the 2nd"
    agent_role: Option<String>,        // 角色类型
}
```

`agent_path` 构成树形索引，使得按路径查找子 Agent 成为可能。

---

## 4. 并发控制：Guards 系统

### 4.1 设计动机

多个 Agent 并发运行时，需要解决：
- **资源限制**：最多同时运行 N 个 Agent
- **深度限制**：防止无限嵌套
- **命名管理**：昵称唯一性，避免冲突

### 4.2 数据结构

```rust
// codex-rs/core/src/agent/guards.rs

pub(crate) struct Guards {
    active_agents: Mutex<ActiveAgents>,  // 活跃 Agent 集合
    total_count: AtomicUsize,             // 总创建计数
}

struct ActiveAgents {
    agent_tree: HashMap<String, AgentMetadata>,  // 路径 → 元数据
    used_agent_nicknames: HashSet<String>,      // 已占用昵称池
    nickname_reset_count: usize,                  // 昵称重置计数
}
```

### 4.3 深度限制

```rust
pub(crate) fn exceeds_thread_spawn_depth_limit(depth: i32, max_depth: i32) -> bool {
    depth > max_depth
}
```

根 Agent depth=0，每嵌套一层 depth+1，超出 `agent_max_depth` 配置值则拒绝创建。

### 4.4 SpawnReservation：RAII 资源预留

```rust
pub(crate) struct SpawnReservation {
    state: Arc<Guards>,
    active: bool,
    reserved_agent_nickname: Option<String>,
    reserved_agent_path: Option<AgentPath>,
}
```

采用 RAII 模式：`SpawnReservation` 在作用域结束时自动释放预留槽位，即使发生 panic 也保证资源不泄漏。

---

## 5. 父子通信机制

### 5.1 通信模型

```
┌─────────────┐  send_input   ┌─────────────┐
│   父 Agent  │ ───────────→  │   子 Agent  │
│             │               │             │
│             │ ←─── 事件注入 ───  │ (完成后通知) │
└─────────────┘               └─────────────┘
```

### 5.2 父→子：send_input

通过 `send_input` 工具向子 Agent 发送消息：

```rust
// codex-rs/core/src/tools/handlers/multi_agents/send_input.rs

struct SendInputArgs {
    agent_id: Option<String>,   // ThreadId
    task_name: Option<String>,   // 或按 task_name 查找
    message: Option<String>,
    items: Option<Vec<UserInput>>,  // 富输入（文件/图像等）
}
```

### 5.3 子→父：完成监视器

子 Agent 进入终态（完成/失败/中断）时，自动向父线程注入通知消息：

```rust
// control.rs - maybe_start_completion_watcher

tokio::spawn(async move {
    // 订阅子 Agent 状态
    let status = control.subscribe_status(child_thread_id).await;

    // 状态变为终态时，向父线程注入消息
    parent_thread.inject_user_message_without_turn(
        format_subagent_notification_message(child_reference, &status)
    );
});
```

关键点：
- `subscribe_status()` 返回一个 Future，直到子 Agent 状态变化才返回
- 通知消息格式化为用户可读文本，注入父线程的输入队列
- 父 Agent 收到通知后，可调用 `wait_agent` 获取子 Agent 的执行结果

---

## 6. 工具层：Multi-Agents 工具集

### 6.1 工具清单

| 工具名 | 文件 | 功能 | 关键参数 |
|--------|------|------|---------|
| `spawn_agent` | `spawn.rs` | 创建新子 Agent | `task_name`, `agent_type`, `model`, `fork_context: bool`, `reasoning_effort` |
| `send_input` | `send_input.rs` | 向子 Agent 发消息 | `target: String`, `message`, `items`, `interrupt: bool` |
| `wait_agent` | `wait.rs` | 等待子 Agent 完成 | `targets: Vec<String>`, `timeout_ms: Option<i64>` |
| `close_agent` | `close_agent.rs` | 关闭子 Agent 及其 open descendants | `target: String` |
| `resume_agent` | `resume_agent.rs` | 恢复已关闭的 Agent | `id: String` |
| `spawn_agents_on_csv` | `agent_jobs.rs` | 批量 CSV 处理（每个 row 一个 worker） | `csv_path`, `instruction`, `output_csv_path` |

### 6.2 spawn_agent 详细参数

```rust
struct SpawnAgentArgs {
    message: Option<String>,           // 初始消息内容
    items: Option<Vec<UserInput>>,     // 富输入项
    task_name: Option<String>,         // 任务名 → 成为 agent_path 的一部分
    agent_type: Option<String>,        // 角色类型：default / explorer / worker
    model: Option<String>,             // 指定模型（如 o4-mini）
    reasoning_effort: Option<ReasoningEffort>,  // 推理强度
    fork_context: bool,                // 是否 fork 父 Agent 的上下文
}
```

返回结果：

```rust
struct SpawnAgentResult {
    agent_id: Option<String>,    // ThreadId（未命名时）
    task_name: Option<String>,  // 任务名（命名时）
    nickname: Option<String>,   // Agent 昵称（如 "Arthur the 2nd"）
}
```

### 6.3 fork_context 机制（内部实现）

`fork_context: true` 时，内部映射为 `SpawnAgentOptions.fork_parent_spawn_call_id`：

```rust
// spawn.rs 内部
SpawnAgentOptions {
    fork_parent_spawn_call_id: args.fork_context.then(|| call_id.clone()),
}
```

逻辑含义：
- `fork_parent_spawn_call_id = Some(call_id)` → 子 Agent 以 **Forked 模式**启动，从父线程的 rollout JSONL 文件读取历史
- `fork_parent_spawn_call_id = None` → 子 Agent 以**新会话**启动，无历史继承

两者共享 `AgentControl`（`Guards` 资源池），但各自有独立消息队列和执行流。

### 6.4 工具注册（条件）

```rust
// codex-rs/core/src/tools/spec.rs

if config.multi_agent_v2 {
    builder.register_handler("spawn_agent", Arc::new(SpawnAgentHandler));
    builder.register_handler("send_input", Arc::new(SendInputHandler));
    builder.register_handler("wait_agent", Arc::new(WaitAgentHandler));
    builder.register_handler("close_agent", Arc::new(CloseAgentHandler));
}
```

**注意**：Multi-agents 工具集依赖 `multi_agent_v2` 功能开关，非无条件注册。

wait_agent 超时参数：
- `timeout_ms` 默认 **30000ms**，最小 **10000ms**，最大 **3600000ms**（1小时）
- 超时后返回空状态，不抛错

所有工具通过 `ToolSpec` 定义输入/输出 schema，与前端（CLI/VSCode）解耦。

---

## 7. 角色系统

### 7.1 设计目的

角色系统允许定义不同"性格"和"能力"的 Agent 模板，通过 TOML 配置文件实现。

### 7.2 内置角色

```rust
// codex-rs/core/src/agent/role.rs

static CONFIG: LazyLock<BTreeMap<String, AgentRoleConfig>> = LazyLock::new(|| {
    BTreeMap::from([
        ("default", AgentRoleConfig { /* 默认配置 */ }),
        ("explorer", AgentRoleConfig {
            description: Some("...".to_string()),
            config_file: Some("explorer.toml".parse().unwrap_or_default()),
            // ...
        }),
        ("worker", AgentRoleConfig { /* 工作型配置 */ }),
    ])
});
```

### 7.3 角色应用流程

```
spawn_agent(task_name="xxx", agent_type="explorer")
    ↓
apply_role_to_config(base_config, "explorer")
    ↓
加载 explorer.toml 配置文件
    ↓
合并到基础配置（保留父级的 provider/profile）
    ↓
创建新 Agent 线程
```

配置文件存放于 `~/.codex/roles/` 或项目内。

---

## 8. 协议层：SessionSource

### 8.1 来源类型

```rust
// codex-rs/protocol/src/protocol.rs

pub enum SessionSource {
    Cli,           // 命令行会话
    VSCode,        // VSCode 插件
    Exec,          // 程序化执行
    Mcp,           // MCP (Model Context Protocol)
    Custom(String),
    SubAgent(SubAgentSource),  // 子 Agent 专用
}
```

### 8.2 子 Agent 来源细分

```rust
// codex-rs/protocol/src/protocol.rs

pub enum SubAgentSource {
    Review,                    // 评审操作（会话来源标签）
    Compact,                   // 压缩操作（会话来源标签）
    ThreadSpawn {              // 线程派生（真正的子 Agent）
        parent_thread_id: ThreadId,
        depth: i32,                   // 嵌套深度（根=0）
        agent_path: Option<AgentPath>,
        agent_nickname: Option<String>,
        agent_role: Option<String>,
    },
    MemoryConsolidation,       // 记忆整合（会话来源标签）
    Other(String),             // 自定义扩展
}
```

> 注意：`SessionSource::SubAgent(_)` 中除 `ThreadSpawn` 外，其余变体的 `depth` 返回 0（见 `session_depth()` 函数）。

### 8.3 Compact 不是独立子 Agent——是会话来源标签

**重要澄清**：`SubAgentSource::Compact` 不是通过 `spawn_agent` 创建的子线程。

类型定义中 `"compact"` 是字符串字面量（非对象），表明它只是一个**会话来源元数据标签**，等价于 `Review` 和 `MemoryConsolidation`。

真正会**创建独立子 Agent 线程**的只有 `ThreadSpawn`。

具体来说，`SubAgentSource::Compact` 的作用是：

1. **API 请求标记**：通过 HTTP header `x-openai-subagent: compact` 告知后端这是压缩操作
2. **产品限制过滤**：在 `app-server/filters.rs` 中，`SubAgentCompact` 用于限制可调用来源
3. **会话追踪**：在遥测和日志中标识操作来源

### 8.4 CompactTask 的实际运行机制

Compact 在当前 Session 内作为 `CompactTask` 执行，而非独立子线程：

```rust
// tasks/compact.rs
impl SessionTask for CompactTask {
    fn kind(&self) -> TaskKind { TaskKind::Compact }
    async fn run(self, session, ctx, input, cancellation) -> Option<String> {
        // OpenAI Provider → 走远程压缩 API
        if should_use_remote_compact_task(&ctx.provider) {
            run_remote_compact_task(session, ctx).await
        } else {
            // 非 OpenAI Provider → 本地 summarization
            run_compact_task(session, ctx, input).await
        }
    }
}
```

#### 压缩流程（以 OpenAI 为例）

```
当前 Session
  ├── 检测到 context window 压力
  │   (触发时机: pre-turn / mid-turn / 手动)
  │
  ├── spawn_task(CompactTask)        ← 同 Session 内任务，非子 Agent
  │
  ├── emit_turn_item_started(ContextCompactionItem)
  │
  ├── model_client.compact_conversation_history()
  │   ├── 请求 header: x-openai-subagent: compact  ← 标记来源
  │   ├── 发送完整历史给模型
  │   └── 模型返回压缩后的摘要
  │
  ├── process_compacted_history()    ← 处理返回的压缩历史
  │   ├── 丢弃 developer 消息
  │   ├── 保留 user/assistant 消息和 compaction 标记
  │   └── 插入初始上下文（mid-turn 时）
  │
  ├── replace_compacted_history()    ← 用压缩历史替换原始历史
  │
  └── emit_turn_item_completed()
```

#### 压缩时机分类

| 时机 | InitialContextInjection | 说明 |
|------|------------------------|------|
| Pre-turn（自动/手动） | `DoNotInject` | 在用户消息前压缩，下次 turn 重新注入初始上下文 |
| Mid-turn（turn 中途） | `BeforeLastUserMessage` | 在最后一条用户消息前插入初始上下文，保持模型训练预期 |

#### 压缩输出结构

```rust
struct CompactedItem {
    message: String,                      // 摘要文本
    replacement_history: Vec<ResponseItem>  // 压缩后的历史
}
```

压缩后历史格式：
```
[初始上下文（可选）]
[保留的用户消息文本]
[SUMMARY_PREFIX\n<摘要内容>]  ← 格式化为 user role 消息
[<GhostSnapshot（用于 /undo）>]
```

### 8.5 压缩与子 Agent 的交互

当子 Agent（`ThreadSpawn`）在执行时触发压缩：

- 压缩在**父 Session** 内执行
- 子 Agent 的上下文不受父压缩影响（各自独立历史）
- 跨 Session 的 `fork` / `resume` 操作后，压缩历史可以被复用
- `compact_resume_fork` 测试验证了：压缩 → resume → fork → 再压缩 → resume 的完整链路中，模型可见历史的一致性

---

## 9. 持久化：线程关系存储

### 9.1 数据库schema

```sql
-- codex-rs/state/migrations/0021_thread_spawn_edges.sql

-- 父子线程关系（有向边）
CREATE TABLE thread_spawn_edges (
    parent_thread_id TEXT NOT NULL,
    child_thread_id TEXT NOT NULL PRIMARY KEY,
    status TEXT NOT NULL  -- snake_case: "open" | "closed"
);

CREATE INDEX idx_thread_spawn_edges_parent_status
    ON thread_spawn_edges(parent_thread_id, status);
```

### 9.2 核心方法

| 方法 | 用途 |
|------|------|
| `upsert_thread_spawn_edge()` | 创建父子关系 |
| `set_thread_spawn_edge_status()` | 标记关系状态 |
| `list_thread_spawn_children_with_status()` | 列出子线程 |
| `find_thread_spawn_child_by_path()` | 按路径查找子线程 |

持久化使得：
- 跨会话追踪子 Agent 历史
- 支持 `wait_agent` 恢复等待
- 提供审计和可追溯性

---

## 10. 完整调用流程

```
用户: "spawn_agent帮我探索这个代码库"
    │
    ▼
ToolHandler::handle("spawn_agent")
    │
    ▼
解析 SpawnAgentArgs
    │
    ▼
Guards::reserve_spawn_slot()      ──→ [拒绝？] ──→ 返回错误
    │
    ▼
检查深度限制 (exceeds_thread_spawn_depth_limit)
    │
    ▼
构建 AgentSpawnConfig
    │
    ▼
apply_role_to_config()            ──→ [有 agent_type?] ──→ 加载 TOML
    │
    ▼
AgentControl::spawn_agent_with_metadata()
    │
    ▼
ThreadManagerState::spawn_new_thread()
    │
    ▼
注册到活跃 Agent 树 (Guards::active_agents)
    │
    ▼
发送初始输入 (message + items)
    │
    ▼
maybe_start_completion_watcher()  ──→ 启动后台监视任务
    │
    ▼
返回 { agent_id, task_name, nickname }
```

---

## 11. 关键文件索引

| 文件 | 行数 | 职责 |
|------|------|------|
| `core/src/agent/control.rs` | ~893 | Agent 生命周期控制 |
| `core/src/agent/role.rs` | ~424 | 角色配置系统 |
| `core/src/agent/guards.rs` | ~316 | 并发控制与深度限制 |
| `core/src/agent/status.rs` | - | Agent 状态定义 |
| `core/src/tools/handlers/multi_agents/spawn.rs` | ~207 | spawn_agent 实现 |
| `core/src/tools/handlers/multi_agents/send_input.rs` | ~118 | send_input 实现 |
| `core/src/tools/handlers/multi_agents/wait.rs` | ~200 | wait_agent 实现 |
| `core/src/tools/handlers/multi_agents/close_agent.rs` | ~100 | close_agent 实现 |
| `protocol/src/protocol.rs` (行 2265-2403) | ~140 | SessionSource 定义 |
| `state/src/runtime/threads.rs` | ~1000+ | 线程持久化 |
| `core/src/tools/spec.rs` | ~3000+ | 工具规范注册 |

---

## 12. 设计总结

### 12.1 SubAgentSource 四种类型辨析

| 类型 | 是否创建独立线程 | 性质 | 用途 |
|------|----------------|------|------|
| `ThreadSpawn` | **是** | 真正子 Agent | 通过 `spawn_agent` 工具创建 |
| `Review` | 否 | 会话来源标签 | API 请求标记（x-openai-subagent: review） |
| `Compact` | 否 | 会话来源标签 | API 请求标记（x-openai-subagent: compact） |
| `MemoryConsolidation` | 否 | 会话来源标签（昵称固定为 "Morpheus"） | API 请求标记（x-openai-subagent: memory_consolidation） |
| `Other(String)` | 否 | 自定义扩展 | 供插件/MCP 等扩展机制使用 |

**设计意图**：`Review`、`Compact`、`MemoryConsolidation` 本质上都是"特殊操作"，用 `SubAgentSource` 统一标记是为了让 API 后端区分这些操作的性质（与普通 CLI/VSCode 会话不同），而不是为了在进程内创建多个 Agent。

### 12.2 核心权衡

| 决策 | 收益 | 代价 |
|------|------|------|
| 线程模型 | 低开销、快速启动 | 隔离性弱（依赖进程沙箱） |
| 弱引用避免循环 | 防止内存泄漏 | 父线程析构时需处理孤儿 |
| 昵称池 | 避免命名冲突 | 需要 reset 机制 |
| TOML 角色 | 灵活可扩展 | 运行时解析有开销 |
| 事件注入通信 | 异步解耦 | 调试复杂（调用栈分裂） |
| Compact 作为 Task 而非 Agent | 避免额外上下文切换开销 | 压缩占用主 Agent 的 context window |

### 12.3 与其他 Agent 框架的对比

| 框架 | 子代理模型 | 通信方式 |
|------|-----------|---------|
| Codex CLI | 线程（`ThreadSpawn`）+ 会话标签 | 事件注入 + Tool call |
| LangChain Agents | 进程/容器 | Tool call |
| AutoGPT | 进程 | HTTP/gRPC |
| CrewAI | 进程 | 消息队列 |

### 12.4 可改进方向

1. **调试体验**：调用栈跨越父子 Agent 时缺乏统一的 trace ID
2. **资源隔离**：危险操作仍依赖进程沙箱，线程模型本身无隔离
3. **动态角色**：TOML 静态加载，无运行时热更新
4. **错误传播**：子 Agent 失败时的父 Agent 恢复策略较简单
5. **Compact 资源竞争**：压缩在主 Session 内执行，会与主任务竞争 context window
6. **open descendants 关闭粒度**：`close_agent` 关闭"所有 live descendants"，对于大规模并行 Agent 树可能过于激进
