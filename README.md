# msgcode

> 用 iMessage 替代 Matrix，实现 Mac 本地的 AI Bot 系统

[![PRD](https://img.shields.io/badge/PRD-v0.1-blue)](./PRD.md)

---

## 简介

msgcode 是一个基于 iMessage 的本地 AI Bot 系统，通过群组路由实现多个 Bot/Agent 会话。无需云服务器，简化运维。

### 核心特性

- **iMessage 集成**: 基于 `imsg rpc`（无 SDK / 无 AppleScript）
- **群组路由**: 不同群组 → 对应 Claude Project / Bot
- **双向通信**:
  - 输入: iMessage → tmux send-keys
  - 输出: Claude JSONL → iMessage 回复
- **安全机制**: 白名单验证 (Email/Phone)

---

## 配置文件

msgcode 优先从 `~/.config/msgcode/.env` 读取配置，如果不存在则回退到项目根目录的 `.env` 文件。

### 首次安装

```bash
# 创建配置目录
mkdir -p ~/.config/msgcode/log

# 复制示例配置
cp .env.example ~/.config/msgcode/.env

# 编辑配置
vim ~/.config/msgcode/.env
```

### 配置迁移

如果你已经在使用项目根目录的 `.env`，可以迁移到用户配置目录：

```bash
# 创建配置目录
mkdir -p ~/.config/msgcode/log

# 复制现有配置
cp .env ~/.config/msgcode/.env

# 验证
ls -la ~/.config/msgcode/
```

## 日志

msgcode 使用双写策略：同时输出到控制台和日志文件。

### 日志位置

日志文件位于 `~/.config/msgcode/log/msgcode.log`

### 日志级别

通过 `LOG_LEVEL` 环境变量控制：

- `debug` - 调试信息（详细）
- `info` - 常规信息（默认）
- `warn` - 警告信息
- `error` - 错误信息（最少）

在 `.env` 中设置：

```bash
LOG_LEVEL=info
```

### 日志轮转

- 单个日志文件最大 10MB
- 自动轮转，保留最近 3 个日志文件
- 轮转后的文件命名：`msgcode.log.1`, `msgcode.log.2`, `msgcode.log.3`

### 查看日志

```bash
# 查看最新日志
tail -f ~/.config/msgcode/log/msgcode.log

# 查看最近 50 行
tail -50 ~/.config/msgcode/log/msgcode.log

# 搜索错误
grep ERROR ~/.config/msgcode/log/msgcode.log
```

---

## 待办 / TODO

- 日志与监控：增加崩溃重启通知的外部推送/关键指标输出（目前仅本地日志）。
- 配置健壮性：支持配置热加载或提供重启提示机制。
- 测试隔离：测试模式下 mock markAsRead，避免本地 chat.db 权限警告。

---

## 快速开始

### 1. 系统要求

- macOS (需授予 Terminal/IDE "完全磁盘访问权限")
- Node.js >= 18.0.0
- iMessage 已登录
- Claude Code (`claude`) 已安装并登录

> **提示：iCloud 消息同步**
>
> msgcode 2.0 主链路不写 `chat.db`，一般不需要强制关闭 iCloud 消息同步。
> 但如果出现“消息来源/状态不一致”等诡异问题，可以尝试关闭 macOS 的 iCloud 消息同步：
>
> ```
> 系统设置 → Apple ID → iCloud → 关闭"信息（Messages）"
> ```
>
> 可能影响：
> - 消息检测表现不稳定（多设备/云端状态切换）
> - 发送者身份显示混乱（多设备同步冲突）
>
> **尤其注意**：当 macOS 登录账号与 Bot 身份不一致时，问题更严重。

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

### 5. 绑定群聊（2.0 推荐）

1. 在 iMessage 里手动建一个群聊，把 msgcode 的 iMessage 账号拉进群
2. 在群里发送：
   - `/bind acme/ops`
   - `/start`

### 6. 群内命令（输入 `/help` 查看）

常用：
- `/help`：显示命令帮助
- `/bind <workspace>`：绑定当前群到工作区（例：`/bind mylife`）
- `/start`：启动该群对应的 bot 会话

语音（TTS）：
- `/tts <text>`：把指定文本生成语音附件并回发
- `/voice <question>`：先回答，再把“回答内容”转语音附件回发
- `/mode`：查看语音回复模式
- `/mode voice on|off|both|audio`：设置语音模式（`on` 等价 `both`）
- `/mode style <desc>`：设置语音风格描述（VoiceDesign）
- `/mode style-reset`：清空风格（恢复默认）

---

## 目录结构

```
msgcode/
├── PRD.md               # 产品需求文档
├── README.md            # 项目文档
├── package.json         # 依赖配置
├── .env                 # 配置文件
├── scripts/
│   ├── build-imsg.sh    # 源码构建 imsg（供应链收口）
│   └── verify-imsg.sh   # 校验 imsg（hash/权限/版本）
└── src/
    ├── index.ts         # 主入口
    ├── config.ts        # 配置加载
    ├── router.ts        # 群组路由
    ├── security.ts      # 安全验证
    ├── listener.ts      # 消息监听器
    ├── handlers.ts      # 命令分发
    ├── tmux/            # tmux 会话管理
    │   ├── session.ts   # 会话控制
    │   ├── sender.ts    # 发送器
    │   └── responder.ts # 响应器 (核心逻辑)
    └── output/          # Claude 输出处理
        ├── reader.ts    # JSONL 增量读取
        └── parser.ts    # 消息解析
```

---

**Tip:** `msgcode start` 在后台静默运行并把日志写入 `~/.config/msgcode/log/msgcode.log`，`msgcode start debug` 则把日志同步输出到当前终端；如果需要实时看到 Claude 的终端内容，可以用 `LOG_CONSOLE=true msgcode start debug`，让 tmux 内容同时写入控制台和日志，方便在 iMessage 里快速判断「Do you want to proceed?」等互动提示。

`msgcode stop` 只停止 msgcode 进程，**不会**清理 `msgcode-` 前缀的 tmux 会话（用于重启后保留 Claude 上下文）；需要彻底清理时用 `msgcode allstop`。

### 状态与快照命令详解

- `/status` 会向 `tmux capture-pane -t msgcode-<group> -p -S -100` 请求当前状态，回显 Claude 是 ready、正在执行还是等待你的输入（适用于确认 1/2/3 交互）。
- `/snapshot` 会跑 `tmux capture-pane -t msgcode-<group> -p -J`，把最近 200 行终端内容打包发回来，方便在手机上看到 prompt、授权提示或 CLI 的内部日志。
- `/resume` 表示你已经在 tmux 中手动回了那条交互提示（比如 “Do you want to proceed?”、`1. Yes / 2. No`），接下来继续在群组里发消息即可恢复对话。你可以在本机终端执行 `tmux attach -t msgcode-<group>` 或 `tmux send-keys -t msgcode-<group> "1" Enter`，也可以在 `LOG_CONSOLE=true msgcode start debug` 下观察 prompt 再返回 tmux 操作。

当 tmux 里出现 `Do you want to proceed?` 之类交互提示时，请先在 tmux 终端手动输入可选项，Claude 才会继续运行。

---

## 常用命令

在 iMessage 群组中发送：

| 命令 | 说明 |
|------|------|
| `/start` | 启动当前项目的 Claude 会话 |
| `/stop` | 停止会话 |
| `/status` | 查看会话状态 |
| `/snapshot` | 获取终端当前屏幕截图 (文本) |
| `/clear` | 清空 Claude 上下文 |
| `/resume` | 手动输入选项恢复交互（tmux attach 或 send-keys） |
| `/esc` | 发送 ESC 中断操作 |
| *(直接发消息)* | 发送给 Claude 并等待回复 |

### msgcode 2.0（推荐）：群绑定模式（无需编辑 `.env`）

目标：让小白用户“建群就能用”，不再手动维护 `GROUP_*` 配置。

使用方式（两步）：
1. 在 Messages 里**手动创建一个群聊**（用于一个项目/会话）。
2. 在该群里发送 `/bind <dir>` 绑定工作目录。

约定：
- 先配置一个 **Agent Root**（所有项目都在它下面）：
  - `WORKSPACE_ROOT=/Users/<you>/msgcode-workspaces`（可自行加一层 `<agent-name>` 做隔离）
- `/bind` 只接受**相对路径**（统一纳入 root 管理）
- 最终目录永远是：`$WORKSPACE_ROOT/<dir>`
- 目录不存在会自动创建

| 命令 | 说明 |
|------|------|
| `/bind <dir>` | 绑定当前群到工作目录（已绑定则更新为新目录） |
| `/bind` | 返回建议目录并提示你复制确认（避免误绑） |
| `/where` | 查看当前群绑定的工作目录 |
| `/unbind` | 解除当前群绑定（停止路由到任何目录） |
| `/chatlist` | 列出所有已绑定的群组 |
| `/help` | 显示命令帮助 |

示例：
- `/bind acme/ops` → `/Users/<you>/msgcode-workspaces/acme/ops`
- `/bind clientA` → `/Users/<you>/msgcode-workspaces/clientA`
- 修改目录：再次发送 `/bind <newDir>`（只改绑定指针；不自动搬迁文件）
- 不支持：`/bind /abs/path`（必须在 Agent Root 下）

---

## 常见问题

### Q: 为什么 Claude 不回复？
A:
1. 确保已发送 `/bind <dir>` 绑定工作目录。
2. 确保已发送 `/start` 启动会话。
3. 确保运行 msgcode 的终端 + imsg 有读取 `~/Library/Messages` 的权限 (Full Disk Access)。
4. 检查 `IMSG_PATH` 是否正确。

### Q: 消息显示的发送者身份不对？
A: 多设备 iCloud 同步可能导致身份/状态冲突。优先确认 msgcode 使用的是“专用 iMessage 账号”；必要时再尝试关闭 macOS 的 iCloud 消息同步。

### Q: 如何支持多个项目？
A:
- 每个项目/会话建一个群聊，在群里 `/bind <dir>`，之后无需再改 `.env`。

---

## 依赖

- `imsg`: iMessage RPC（建议源码构建并固定版本）
- `tmux`: 终端多路复用器 (系统自带或 brew 安装)
- `claude`: Claude Code CLI 工具

---

## 许可

MIT

---

*更新: 2026-01-28*
