# msgcode

> 用 iMessage 替代 Matrix，实现 Mac 本地的 AI Bot 系统

[![PRD](https://img.shields.io/badge/PRD-v0.1-blue)](./PRD.md)

---

## 简介

msgcode 是一个基于 iMessage 的本地 AI Bot 系统，通过群组路由实现多个 Bot/Agent 会话。无需云服务器，简化运维。

### 核心特性

- **iMessage 集成**: 基于 `@photon-ai/imessage-kit` (SDK)
- **群组路由**: 不同群组 → 对应 Claude Project / Bot
- **双向通信**:
  - 输入: iMessage → tmux send-keys
  - 输出: Claude JSONL → iMessage 回复
- **安全机制**: 白名单验证 (Email/Phone)

---

## 快速开始

### 1. 系统要求

- macOS (需授予 Terminal/IDE "完全磁盘访问权限")
- Node.js >= 18.0.0
- iMessage 已登录
- Claude Code (`claude`) 已安装并登录

### 2. 安装

```bash
# 克隆项目
cd /path/to/msgcode

# 安装依赖
npm install

# 复制配置模板
cp .env.example .env
```

### 3. 获取群组 ID

```bash
# 运行工具获取群组列表
npm run get-chats
```

输出示例：
```
📁 群组 (3)
  1. Code Bot
     guid: i chat;+;chat1234
  2. Image Bot
     guid: i chat;+;chat5678
```

### 4. 配置 .env

```bash
# 配置白名单
MY_EMAIL=me@icloud.com

# 配置群组路由
# 格式: GROUP_<NAME>=<GUID>:<PROJECT_DIR>:<BOT_TYPE>
GROUP_MATCODE=i chat;+;chat1234:/Users/admin/Dev/my-project:code
```

### 5. 启动 Bot

```bash
# 启动（生产模式）
npm start
```

---

## 目录结构

```
msgcode/
├── PRD.md               # 产品需求文档
├── README.md            # 项目文档
├── package.json         # 依赖配置
├── .env                 # 配置文件
├── scripts/
│   └── get-chats.ts     # 获取群组工具
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

## 常用命令

在 iMessage 群组中发送：

| 命令 | 说明 |
|------|------|
| `/start` | 启动当前项目的 Claude 会话 |
| `/stop` | 停止会话 |
| `/status` | 查看会话状态 |
| `/snapshot` | 获取终端当前屏幕截图 (文本) |
| `/clear` | 清空 Claude 上下文 |
| `/esc` | 发送 ESC 中断操作 |
| *(直接发消息)* | 发送给 Claude 并等待回复 |

---

## 常见问题

### Q: 为什么 Claude 不回复？
A:
1. 确保已发送 `/start` 启动会话。
2. 确保 Bot 有读取 `~/Library/Messages` 的权限 (Full Disk Access)。
3. 检查 `.env` 配置的路径是否正确。

### Q: 如何支持多个项目？
A: 在 iMessage 建立多个群组，在 `.env` 中分别配置不同的 `GROUP_*` 和对应的项目路径。

---

## 依赖

- `@photon-ai/imessage-kit`: iMessage 数据库读取与发送
- `tmux`: 终端多路复用器 (系统自带或 brew 安装)
- `claude`: Claude Code CLI 工具

---

## 许可

MIT

---

*更新: 2026-01-09*
