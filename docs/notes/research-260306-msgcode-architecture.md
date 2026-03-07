# msgcode 架构研究笔记

> 研究日期：2026-03-06
> 研究目标：全面理解 msgcode 项目架构，为后续任务执行建立上下文

## 1. 项目概述

**msgcode** 是一个运行在 macOS 上的 AI 智能体，以 iMessage 为主要传输通道，目标是成为可长期运行的基础设施而非一次性聊天应用。

### 核心特性
- **双执行线架构**：Agent 线（智能能力）+ Tmux 线（执行通道）
- **iMessage-first**：通过本地 imsg RPC 客户端与 iMessage 交互
- **本地优先**：支持本地 LLM（LM Studio）、记忆系统、技能管理
- **多传输支持**：iMessage、Feishu WebSocket
- **工作区隔离**：每个群组可绑定独立工作空间

### 版本信息
- 当前版本：v2.3.0
- Node.js + TypeScript 项目
- 关键依赖：`pinchtab@0.7.7`（浏览器自动化）、`better-sqlite3`（记忆存储）

## 2. 核心架构

### 2.1 双执行线模型

| 维度 | Agent 线（默认） | Tmux 线（复杂任务） |
|------|-----------------|-------------------|
| **角色** | 会话中枢（理解/记忆/编排） | 执行通道（终端代理转发） |
| **能力** | SOUL、记忆注入、tool loop、TTS | Shell / Git / 代码编辑 / 长任务 |
| **状态管理** | msgcode 管理会话上下文 | tmux 会话保持执行状态 |
| **典型触发** | 日常对话、轻任务 | 多步骤编程、重型工程任务 |
| **切换方式** | `/model agent-backend` | `/model codex` 或 `/model claude-code` |

**固定边界**：
- Agent 线承载业务语义（记忆、人格、技能）
- Tmux 线只做忠实转发与回传，不隐式注入业务语义

### 2.2 系统分层

```
┌─────────────────────────────────────────┐
│         传输层 (Transport)              │
│  iMessage (imsg RPC) | Feishu WS       │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│         路由层 (Routing)                │
│  按群组/工作区路由消息                  │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│       运行时编排层 (Runtime)            │
│  会话管理 / 调度 / 路由决策             │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│       后端适配层 (Providers)            │
│  Agent Backend | Tmux | Skills         │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│         工具层 (Tools)                  │
│  Tool Bus | 执行器 (bash/browser/...)  │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│       数据持久层 (Memory)               │
│  L0/L1/L2 记忆 + 工作区配置            │
└─────────────────────────────────────────┘
```

## 3. 关键模块与职责

### 3.1 入口与启动 (`src/index.ts`)
- **职责**：应用主入口，单例锁管理，iMessage RPC 客户端启动
- **关键流程**：
  1. 获取单例锁（防止多实例）
  2. 启动 imsg RPC 客户端
  3. 订阅消息事件
  4. 注册异常处理和优雅关闭

### 3.2 消息监听器 (`src/listener.ts`)
- **职责**：消息接收、路由转发、会话控制
- **关键功能**：
  - 白名单检查
  - 消息去重（5分钟 TTL）
  - 路由命令处理（`/bind`, `/unbind`, `/model` 等）
  - Auto TTS Lane（后台语音回复串行化）

### 3.3 路由系统 (`src/router.ts`)
- **职责**：根据 chatId 路由消息到对应处理器
- **路由优先级**：
  1. RouteStore（动态绑定，`/bind` 创建）
  2. GROUP_* 配置（静态配置，向后兼容）
  3. 默认工作区（`$WORKSPACE_ROOT/default`）
- **Bot 类型**：`code` | `image` | `file` | `agent-backend` | `default`

### 3.4 Agent Backend (`src/agent-backend/`)
- **职责**：智能体核心实现，替代历史 `lmstudio.ts`
- **模块结构**：
  - `types.ts`：类型定义
  - `config.ts`：后端配置解析
  - `prompt.ts`：提示词构造
  - `chat.ts`：单轮对话
  - `tool-loop.ts`：工具循环（ReAct 模式）
  - `routed-chat.ts`：路由聊天（多模型协同）

### 3.5 Tool Bus (`src/tools/bus.ts`)
- **职责**：统一工具执行闸门
- **策略模式**：
  - `explicit`：显式命令触发（默认）
  - `autonomous`：模型自主编排
  - `tool-calls`：预留扩展
- **副作用分级**：`read-only` | `local-write` | `message-send` | `process-control`
- **可用工具**：
  - 基础：`tts`, `asr`, `vision`, `mem`, `bash`, `browser`, `desktop`
  - 文件：`read_file`, `write_file`, `edit_file`, `list_directory`
  - 搜索：`search_file`, `search_content`
  - Todo：`todo_read`, `todo_write`

### 3.6 执行器 (`src/runners/`)
- `asr.ts`：语音识别（Whisper）
- `bash-runner.ts`：Shell 命令执行
- `browser-pinchtab.ts`：浏览器自动化（基于 PinchTab）
- `tts.ts`：文本转语音
- `vision_ocr.ts`：视觉 OCR

### 3.7 记忆系统 (`src/memory/`)
- **L0**：会话窗口（`<workspace>/.msgcode/sessions/<chatId>.jsonl`）
- **L1**：会话摘要（上下文预算时压缩旧轮次）
- **L2**：长期记忆（数据文件 `<workspace>/memory/*.md`，索引 `~/.config/msgcode/memory/index.sqlite`）
- **核心组件**：
  - `store.ts`：记忆存储与检索
  - `embedding.ts`：向量化（sqlite-vec）
  - `chunker.ts`：文本分块

### 3.8 运行时编排 (`src/runtime/`)
- `session-orchestrator.ts`：会话编排
- `model-service-lease.ts`：模型服务租约管理（空闲释放）
- `heartbeat.ts`：心跳与事件唤醒
- `thread-store.ts`：线程存储
- `singleton.ts`：单例锁

## 4. 数据流

### 4.1 消息处理流程

```
iMessage 收到消息
    ↓
listener.ts 接收
    ↓
白名单检查 + 去重
    ↓
路由决策 (router.ts)
    ↓
命令判断（是否为 /bind, /model 等）
    ↓
  是 → 命令处理器 (routes/commands.ts)
    ↓
  否 → 查找对应 handler (handlers.ts)
    ↓
Agent Backend / Tmux 处理
    ↓
工具执行（tools/bus.ts）
    ↓
结果回复（通过 imsg RPC）
```

### 4.2 Tool Loop 流程

```
用户输入
    ↓
构造系统提示词（注入 SOUL、记忆、工具清单）
    ↓
调用 LLM
    ↓
  有工具调用？
    ↓
  是 → 解析工具参数 → 验证 → 执行 → 记录结果 → 回到 LLM
    ↓
  否 → 返回最终答案
```

## 5. 技术栈

### 5.1 核心技术
- **语言**：TypeScript (ESM)
- **运行时**：Node.js + Bun（测试）
- **平台**：macOS（Apple Silicon 优先）

### 5.2 关键依赖
- `@larksuiteoapi/node-sdk`：飞书开放平台 SDK
- `better-sqlite3`：SQLite 数据库
- `sqlite-vec`：向量存储（语义记忆）
- `pinchtab`：浏览器自动化底座
- `commander`：CLI 框架
- `croner`：定时任务

### 5.3 外部依赖
- **imsg**：本地 iMessage RPC 客户端（`vendor/imsg/`）
- **LM Studio**：本地 LLM 服务器（HTTP API）
- **Chrome/Chromium**：浏览器自动化底座

## 6. 工作区与配置

### 6.1 工作区结构
```
<workspace>/
├── .msgcode/
│   ├── config.json          # 工作区配置
│   ├── providers.json       # 后端配置
│   ├── SOUL.md              # 个性提示词
│   └── sessions/            # L0 会话窗口
├── memory/                  # L2 长期记忆数据
└── <project files>
```

### 6.2 全局配置
```
~/.config/msgcode/
├── souls/                   # SOUL 模块市场
│   ├── default/SOUL.md
│   └── active.json
├── skills/                  # 技能目录
├── memory/
│   └── index.sqlite         # 记忆索引
└── .env                     # 环境配置
```

### 6.3 关键环境变量
- `MY_EMAIL`：iMessage 账号
- `IMSG_PATH`：imsg 二进制路径
- `WORKSPACE_ROOT`：工作区根目录
- `PINCHTAB_BASE_URL`：PinchTab Orchestrator 地址
- `PINCHTAB_TOKEN`：PinchTab 鉴权令牌（可选）

## 7. 当前工作状态

### 7.1 最近完成（2026-03-06）
1. **浏览器核心集成**（Issue 0004）
   - 引入 `pinchtab@0.7.7` 作为浏览器底座
   - 新增 Chrome 工作根目录管理
   - 新增 `msgcode browser root` 命令

2. **Agent Backend 拆分**（Issue 0002）
   - 从 `lmstudio.ts` 拆分核心实现到 `agent-backend/`
   - `lmstudio.ts` 改为兼容壳

3. **Feishu WS 传输**（Issue 0003）
   - 集成 WebSocket 传输
   - 默认工作区 fallback

### 7.2 活跃 Issues
- **0005**：Browser tool 未暴露给 LLM
- **0006**：Agent relentless task closure

### 7.3 Git 状态
- 当前分支：`codex/feishu-ws-mvp`
- 主分支：`main`
- 最近提交：`feat(feishu): integrate ws transport and default workspace fallback`

## 8. 风险点与注意事项

### 8.1 技术风险
1. **iMessage 依赖**：依赖 macOS 本地能力，系统升级可能影响稳定性
2. **单例锁**：多实例检测基于文件锁，进程崩溃可能残留锁文件
3. **浏览器自动化**：PinchTab 版本升级可能引入不兼容变更

### 8.2 架构约束
1. **双线分离**：Agent 线与 Tmux 线必须严格分离，避免隐式注入业务语义
2. **工具单一真相源**：所有工具调用必须通过 `tools/bus.ts`
3. **记忆层级隔离**：`/clear` 只清理 L0/L1，不清理 L2

### 8.3 测试覆盖
- **测试框架**：Bun test + Cucumber (BDD)
- **当前通过率**：530 tests pass
- **回归检查点**：
  - 行为锁测试（防止只做字符串断言）
  - 契约测试（provider/tool runner）
  - 冒烟测试（主流程）

## 9. 开发规范

### 9.1 代码规范
1. 新业务能力优先放入分层目录，避免扩展根级大文件
2. 新增入口函数必须补行为锁测试
3. 中性主语优先：新代码走 `agent-backend`，`lmstudio` 仅保留兼容语义
4. 中文注释：类、函数、关键逻辑块必须中文注释

### 9.2 文档规范
1. **issues/**：任务与事实记录（真相来源）
2. **docs/design/**：Plan 文档（设计决策 + 实施计划）
3. **docs/notes/**：研究/实验记录
4. **docs/CHANGELOG.md**：外部可见变更日志

### 9.3 提交规范
- PR 标题引用 issue：`Issue: NNNN`
- 若有 Plan 文档必须引用：`Plan: docs/design/plan-YYMMDD-<topic>.md`
- 外部可见变更必须更新 CHANGELOG

## 10. 关键决策记录

### 10.1 为什么选择 iMessage-first？
- **系统级集成**：iMessage 是 macOS 原生能力，无需额外 SDK
- **用户体验**：用户日常使用 iMessage，无需切换应用
- **隐私保护**：本地 RPC 客户端，不经过云端

### 10.2 为什么拆分 Agent Backend？
- **中性命名**：`lmstudio` 是特定实现，`agent-backend` 是通用概念
- **架构演进**：未来可能接入其他后端（OpenAI、Claude 等）
- **兼容性**：保留 `lmstudio.ts` 作为兼容壳，不破现网

### 10.3 为什么引入 PinchTab？
- **浏览器隔离**：PinchTab 提供 Chrome 实例管理和 CDP 控制
- **并发支持**：支持多实例、多会话并发
- **故障恢复**：实例健康检查和自动重启

---

## 附录：快速导航

### 关键文件
- 主入口：`src/index.ts`
- 消息监听：`src/listener.ts`
- 路由系统：`src/router.ts`
- Agent 核心：`src/agent-backend/index.ts`
- Tool Bus：`src/tools/bus.ts`
- CLI 命令：`src/cli.ts`

### 文档索引
- 项目 README：`README.md`
- 源码说明：`src/README.md`
- 测试说明：`test/README.md`
- 产品叙事：`docs/product/pitch.md`
- 变更日志：`docs/CHANGELOG.md`

### 脚本命令
```bash
# 开发
npm run dev          # 前台调试
npm start            # 后台运行

# 测试
npm test             # 单元测试
npm run bdd          # BDD 测试
npm run test:all     # 全量测试

# 工具
npm run docs:check   # 文档同步检查
npm run memory:e2e   # 记忆系统端到端测试
```
