# msgcode

> Mac 上的 AI 智能体，iMessage 通道优先

---

## Desktop Quickstart（3 步）

> msgcode v2.3 支持 Desktop Bridge，实现 Mac 本地 UI 自动化（截图/AX树/点击/输入/快捷键）。

### 步骤 1: 启动 Desktop Host

```bash
# 打开 MsgcodeDesktopHost.app（首次需授予权限）
open mac/MsgcodeDesktopHost/MsgcodeDesktopHost.app

# 或通过 Menubar 验证：点击 "Doctor" 查看权限状态
```

### 步骤 2: 检查权限

系统设置 → 隐私与安全性 → 辅助功能 ✓
系统设置 → 隐私与安全性 → 屏幕录制 ✓

### 步骤 3: 发起请求

```bash
# 健康检查
npx tsx src/cli.ts /desktop health

# 截图 + AX 树（落盘到 workspace/artifacts/desktop/）
npx tsx src/cli.ts /desktop observe

# 查找 UI 元素
npx tsx src/cli.ts /desktop find --byRole AXButton --titleContains "Send"

# 点击元素（需 confirm）
npx tsx src/cli.ts /desktop click --selector '{"byRole": "AXButton"}' --phrase "CONFIRM"
```

**完整文档**: [docs/desktop/](./docs/desktop/)

---

## 简介

msgcode 是一个运行在 Mac 上的 AI 智能体系统，默认以 iMessage 作为优先通道，通过群组路由实现多 Agent 会话。无需云服务器，简化运维。

### 核心特性

- **iMessage 集成**: 基于 `imsg rpc`（无 SDK / 无 AppleScript）
- **群组路由**: 不同群组 → 对应工作区
- **双向通信**: iMessage → tmux → Claude/LM Studio → iMessage
- **JSONL 读取**: claude 和 claude-code 优先 JSONL 日志读取（pane 为 fallback），确保响应完整准确
- **安全机制**: 白名单验证 + owner 收口

### 双管道边界（固定约束）

- **tmux 管道（codex/claude-code）**：只做“忠实转发与回传”，不注入 SOUL/记忆等业务语义。
- **direct 管道（lmstudio + openclaw 私有实现）**：承载 SOUL、记忆、tool loop 等智能体能力。
- 两条管道职责隔离，配置独立，不互相隐式继承行为。

---

## 快速开始

### 1. 系统要求

- macOS (需授予 Terminal/IDE "完全磁盘访问权限")
- Node.js >= 18.0.0
- iMessage 已登录
- Claude Code 或 LM Studio 已安装

### 2. 安装

```bash
# 克隆项目
cd /path/to/msgcode

# 安装依赖
npm install

# 初始化配置（推荐）
msgcode init
```

`msgcode init` 现在会自动补齐：
- `~/.config/msgcode/souls/default/SOUL.md`（全局 SOUL 默认模板）
- `~/.config/msgcode/souls/active.json`（全局 SOUL 激活映射）
- `~/.config/msgcode/skills/`（全局 Skills 根目录）

### 3. 配置 ~/.config/msgcode/.env

```bash
# 配置白名单
MY_EMAIL=me@icloud.com

# imsg 二进制路径（必填）
IMSG_PATH=/Users/<you>/msgcode/vendor/imsg/v0.4.0/imsg

# 工作空间根目录（可选；默认 ~/msgcode-workspaces）
WORKSPACE_ROOT=/Users/<you>/msgcode-workspaces

# （可选）OpenViking 记忆增强
OPENVIKING_ENABLED=1
OPENVIKING_BASE_URL=http://localhost:8080
OPENVIKING_TIMEOUT_MS=5000
OPENVIKING_FALLBACK=1
```

### 4. 启动 Bot

```bash
# 后台启动
msgcode start

# 或前台 debug
msgcode start debug
```

### 5. 绑定群聊

1. 在 iMessage 里手动建一个群聊，把 msgcode 的 iMessage 账号拉进群
2. 在群里发送：
   - `/bind acme/ops`
   - `/start`

`/bind` 后会自动补齐工作区基础文件：
- `<WORKSPACE>/.msgcode/config.json`
- `<WORKSPACE>/.msgcode/providers.json`
- `<WORKSPACE>/.msgcode/SOUL.md`

---

## 最小命令集

| 命令 | 说明 |
|------|------|
| `/start` | 启动/停止会话 |
| `/status` | 查看当前状态 |
| `/bind <dir>` | 绑定群组到工作目录 |
| `/where` | 查看当前工作区 |
| `/unbind` | 解除工作区绑定 |
| `/model` | 查看或切换模型 |
| `/mode` | 切换响应模式 |
| `/tts` | 文字转语音 |
| `/voice` | 语音交互 |
| `/soul` | 人格与定时任务 |
| `/help` | 显示帮助（**真相源**） |
| `/info` | 查看处理状态 |

**完整命令列表**：在 iMessage 群组中发送 `/help` 查看

---

## 常见排障

### Claude 不回复？

1. 确保已发送 `/bind <dir>` 绑定工作目录
2. 确保已发送 `/start` 启动会话
3. 发送 `/status` 查看会话状态
4. 发送 `/where` 查看当前绑定
5. 检查 Terminal/IDE 是否有 "完全磁盘访问权限"
6. 检查 `IMSG_PATH` 是否正确

**JSONL 读取规则**：claude 和 claude-code 优先从 JSONL 日志读取（`~/.claude/projects/**/*.jsonl`），确保响应完整准确。如果 JSONL 文件不存在或读取失败，自动 fallback 到 tmux pane 读屏。

### 消息发送者身份不对？

多设备 iCloud 同步可能导致身份冲突。建议：
- msgcode 使用"专用 iMessage 账号"
- 必要时关闭 macOS 的 iCloud 消息同步

### 如何支持多个项目？

每项目建一个群聊，在群里 `/bind <dir>`，无需修改 `.env`。
发送 `/info` 查看所有已绑定的群组。

### 需要更多诊断？

- `/info` 查看处理状态
- `/model` 切换执行臂（支持 lmstudio、codex、claude-code）

---

## Tool Bus 观测与灰度

msgcode v2.2 引入了 Tool Bus 统一工具执行闸门，提供结构化日志和灰度控制能力。

### 工具策略模式

- **explicit（默认）**: 只允许显式命令触发工具（稳态）
- **autonomous**: 模型可自主编排调用工具（含 shell/browser），全信任策略
- **tool-calls（预留）**: 标准 tool_calls 自动工具调用

### 观测命令

Tool Bus 详细命令请参考 `/help` 或文档 [docs/toolbus](./docs/toolbus/)。

### 灰度流程

1. 灰度前：查看工具执行统计
2. 修改配置：添加工具到允许列表
3. 生效配置：重新加载配置
4. 灰度后：全量回归测试

详细说明以仓库内文档为准（开源导出默认不包含 `AIDOCS/`）。

---

## LM Studio（默认执行臂）

当前默认执行臂固定为 LM Studio。`mlx` 仅保留兼容别名，会归一化到 `lmstudio`。

### 特性

- **OpenAI 兼容 API**: 兼容 chat completions 和 models listing 端点
- **工具闭环**: 支持 tools + tool_choice + role=tool 回灌
- **配置灵活**: 通过 workspace `providers.json` 配置 baseUrl/model/参数
- **稳定优先**: 生产默认以 LM Studio 为主

### 切换到 LM Studio

```bash
/model lmstudio
```

### 默认 Provider 配置

在 `<WORKSPACE>/.msgcode/providers.json` 中配置：

```json
{
  "active": "lmstudio-local",
  "providers": {
    "lmstudio-local": {
      "type": "openai-compat",
      "baseUrl": "http://127.0.0.1:1234/v1",
      "model": ""
    }
  }
}
```

### 工具闭环使用

1. 启动 LM Studio 本地服务（OpenAI Compatible）
2. 切换到 autonomous 模式：修改 `tooling.mode` 为 `autonomous`
3. 发送消息，模型可自主调用工具并回灌结果

---

## PI / SOUL / 记忆（Filesystem-First）

### PI 打开后得到什么

- **结构化注入**：System Base → SOUL → SKILL → Memory → User → Runtime Guards
- **分层记忆**：L0/L1/L2 检索注入（即时/短期/长期）
- **可观测性**：debug 中可看到 `memoryTrace`、`activeSoulId`、`activeSoulVersion`
- **不阻断**：检索失败时自动降级，不影响主链路回复

### SOUL 文件位置

- 全局 SOUL：`~/.config/msgcode/souls/default/SOUL.md`
- 全局激活映射：`~/.config/msgcode/souls/active.json`
- 工作区 SOUL：`<WORKSPACE>/.msgcode/SOUL.md`
- 市场安装 SOUL：`~/.config/msgcode/souls/<id>/<version>/SOUL.md`

### 记忆真相源

- 工作区目录：`<WORKSPACE>/.msgcode/memory/`
- `entries/`：记忆条目
- `index.json`：轻量索引
- `deposition.jsonl`：沉淀事件流

### OpenViking 说明

- 默认本地 memory 可用（离线、稳定）
- 开启 OV 后增强语义召回能力（适合更长历史）
- OV 不可用时自动 fallback 到本地 memory（不影响对话）

---

## 文档索引

### Desktop Bridge

| 文档 | 说明 |
|------|------|
| [完整文档](./docs/desktop/) | Desktop 能力总入口 |
| [API 契约](./docs/desktop/contract.md) | JSON-RPC 2.0 契约（**API 真相源**） |
| [Recipes](./recipes/desktop/) | 自动化流程示例 |
| [Security](./SECURITY.md) | 安全模型与威胁假设 |
| [Releasing](./RELEASING.md) | 开源发布与快速验收 |

### 内部规划（不随开源导出）

仓库内存在 `AIDOCS/`（内部规划、验收记录、过程资产），默认不随开源导出/打包。

### 依赖

- `imsg`: iMessage RPC（建议源码构建并固定版本）
- `tmux`: 终端多路复用器
- `claude`: Claude Code CLI 工具

## 维护声明

**命令真相源：运行时 `/help`**

本文档仅做架构导读和快速上手参考。所有命令的权威行为以 iMessage 群组中发送 `/help` 的输出为准。

如发现文档与 `/help` 不一致，请以 `/help` 为准并提交 Issue。

---

## 许可

MIT

---

*更新: 2026-02-10*
