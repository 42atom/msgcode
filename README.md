# msgcode

> 用 iMessage 替代 Matrix，实现 Mac 本地的 AI Bot 系统

---

## 简介

msgcode 是一个基于 iMessage 的本地 AI Bot 系统，通过群组路由实现多个 Bot/Agent 会话。无需云服务器，简化运维。

### 核心特性

- **iMessage 集成**: 基于 `imsg rpc`（无 SDK / 无 AppleScript）
- **群组路由**: 不同群组 → 对应工作区
- **双向通信**: iMessage → tmux → Claude/LM Studio → iMessage
- **安全机制**: 白名单验证 + owner 收口

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

### 3. 配置 ~/.config/msgcode/.env

```bash
# 配置白名单
MY_EMAIL=me@icloud.com

# imsg 二进制路径（必填）
IMSG_PATH=/Users/<you>/msgcode/vendor/imsg/v0.4.0/imsg

# 工作空间根目录（可选；默认 ~/msgcode-workspaces）
WORKSPACE_ROOT=/Users/<you>/msgcode-workspaces
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

---

## 最小命令集

| 命令 | 说明 |
|------|------|
| `/bind <dir>` | 绑定群组到工作目录 |
| `/where` | 查看当前群组绑定 |
| `/help` | 显示完整命令帮助（**真相源**） |
| `/start` | 启动会话 |
| `/stop` | 停止会话 |

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

### 消息发送者身份不对？

多设备 iCloud 同步可能导致身份冲突。建议：
- msgcode 使用"专用 iMessage 账号"
- 必要时关闭 macOS 的 iCloud 消息同步

### 如何支持多个项目？

每项目建一个群聊，在群里 `/bind <dir>`，无需修改 `.env`。
发送 `/chatlist` 查看所有已绑定的群组。

### 需要更多诊断？

- `/info` 查看处理状态
- `/model` 切换执行臂（lmstudio/codex/claude-code）
- `/policy` 切换策略模式（本地/外网）

---

## Tool Bus 观测与灰度

msgcode v2.2 引入了 Tool Bus 统一工具执行闸门，提供结构化日志和灰度控制能力。

### 工具策略模式

- **explicit（默认）**: 只允许显式命令触发工具（稳态）
- **autonomous**: 模型可自主编排调用工具（含 shell/browser），全信任策略
- **tool-calls（预留）**: 标准 tool_calls 自动工具调用

### 观测命令

- `/toolstats` - 查看工具执行统计（成功率/平均耗时/Top 错误码/各工具分布）
- `/tool allow list` - 查看当前灰度配置
- `/tool allow add <tool>` - 添加工具到允许列表（需要 `/reload` 生效）
- `/tool allow remove <tool>` - 从允许列表移除工具（需要 `/reload` 生效）

### 灰度流程

1. 灰度前：查看工具执行统计
2. 修改配置：添加工具到允许列表
3. 生效配置：重新加载配置
4. 灰度后：全量回归测试

详细说明见 [AIDOCS 规划文档](./AIDOCS/msgcode-2.2/README.md)。

---

## MLX Provider（工具闭环推荐）

msgcode v2.2+ 支持 MLX LM Server 作为独立的 provider，专门用于 GLM4.7 Flash 工具闭环场景。

### 特性

- **OpenAI 兼容 API**: 兼容 chat completions 和 models listing 端点
- **工具闭环**: 支持 tools + tool_choice + role=tool 回灌
- **配置灵活**: 通过 workspace config.json 配置 baseUrl/modelId/参数
- **自动探测**: 模型 ID 可自动从 models listing 端点探测

### 切换到 MLX

```bash
/model mlx
```

### MLX 配置

在 `<WORKSPACE>/.msgcode/config.json` 中配置：

```json
{
  "mlx.baseUrl": "http://127.0.0.1:18000",
  "mlx.modelId": "",
  "mlx.maxTokens": 512,
  "mlx.temperature": 0.7,
  "mlx.topP": 1
}
```

### 工具闭环使用

1. 启动 `mlx_lm.server`（GLM4.7 Flash MLX 模型）
2. 切换到 autonomous 模式：修改 `tooling.mode` 为 `autonomous`
3. 发送消息，模型可自主调用工具并回灌结果

---

## 文档索引

| 文档 | 说明 |
|------|------|
| [v2.2 规划](./AIDOCS/msgcode-2.2/README.md) | 2.2 总路线图、Slash Commands、Persona/Schedules |
| [路线图](./AIDOCS/msgcode-2.2/roadmap_v2.2.md) | 里程碑/验收/风险 |
| [编排层规划](./AIDOCS/msgcode-2.2/orchestration_plan_v2.2.md) | Persona/Skills/Schedules 编排层 |
| [控制车道规范](./AIDOCS/msgcode-2.2/control_lane_spec_v2.2.md) | 只读命令快车道（/status /where /help /loglevel 秒回） |
| [会话注册规范](./AIDOCS/msgcode-2.2/session_registry_spec_v2.2.md) | tmux 会话元数据落盘（重启不丢 /status 口径） |
| [Desktop Bridge](./AIDOCS/msgcode-2.2/desktop_bridge_contract_v2.2.md) | Desktop Host/Bridge 的 JSON-RPC 契约 |
| [MLX Lab](./scripts/mlx-lab/README.md) | MLX LM Server 实验脚本与冒烟测试 |
[GLM4.7FLASH工具规划参数参考](https://unsloth.ai/docs/basics/tool-calling-
    guide-for-local-llms))
[本地运行](https://unsloth.ai/docs/models/glm-4.7-flash)
---

## 依赖

- `imsg`: iMessage RPC（建议源码构建并固定版本）
- `tmux`: 终端多路复用器
- `claude`: Claude Code CLI 工具

---

## 维护声明

**命令真相源：运行时 `/help`**

本文档仅做架构导读和快速上手参考。所有命令的权威行为以 iMessage 群组中发送 `/help` 的输出为准。

如发现文档与 `/help` 不一致，请以 `/help` 为准并提交 Issue。

---

## 许可

MIT

---

*更新: 2026-02-06*
