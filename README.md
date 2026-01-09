# matcode-mac

> 用 iMessage 替代 Matrix，实现 Mac 本地的 AI Bot 系统

[![PRD](https://img.shields.io/badge/PRD-v0.1-blue)](./PRD.md)

---

## 简介

matcode-mac 是一个基于 iMessage 的本地 AI Bot 系统，通过群组路由实现多个 Bot/Agent 会话。无需云服务器，简化运维。

### 核心特性

- **消息监听**: Socket.IO 实时推送
- **群组路由**: 不同群组 → 不同 Bot 会话
- **命令执行**: 调用 Matcode 逻辑
- **安全机制**: 白名单验证

---

## 快速开始

### 1. 系统要求

- macOS
- Node.js >= 18.0.0
- iMessage 已启用

### 2. 安装

```bash
# 克隆项目
cd /path/to/matcode-mac

# 安装依赖
npm install

# 复制配置模板
cp .env.example .env
```

### 3. 启动 iMessage 服务器

```bash
# 启动 advanced-imessage-kit 服务器
npx @photon-ai/imessage-server-run
```

### 4. 获取群组 ID

```bash
# 运行工具获取群组列表
npm run get-chats
```

输出示例：
```
📁 群组 (3)
  1. Code Bot
     guid: i chat;-;chat1234
     成员: 2 人
  2. Image Bot
     guid: i chat;-;chat5678
     成员: 2 人
```

### 5. 配置 .env

将获取的 `guid` 填入 `.env`：

```bash
GROUP_CODE_BOT=i chat;-;chat1234
GROUP_IMAGE_BOT=i chat;-;chat5678
```

### 6. 启动 Bot

```bash
npm start
```

---

## 目录结构

```
matcode-mac/
├── PRD.md           # 产品需求文档
├── README.md        # 项目文档
├── .env.example     # 配置模板
├── .env             # 实际配置（需创建）
├── scripts/
│   └── get-chats.ts # 获取群组工具
├── src/             # 源代码
│   ├── index.ts     # 主入口
│   ├── config.ts    # 配置加载
│   ├── security.ts  # 安全验证
│   ├── router.ts    # 群组路由
│   ├── handlers.ts  # 命令处理
│   └── listener.ts  # 消息监听
└── ref/             # 参考代码
    ├── advanced-imessage-kit/
    ├── imessage-kit/
    └── MY_AGENT_HOME/
```

---

## 使用说明

### 群组路由

| 群组 | 用途 |
|------|------|
| Code Bot | 代码相关任务 |
| Image Bot | 图像生成 |
| File Bot | 文件推送 |

在对应群组发送消息，自动路由到相应 Bot。

### 白名单

仅响应 `.env` 中配置的号码/邮箱：

```bash
MY_PHONE=+8613800138000
MY_EMAIL=user@icloud.com
```

---

## 常见问题

### Q: 自说自话？
A: 是的，Bot 用你登录的 iMessage 账号发送。通过群组名称区分会话。

### Q: Mac 关机能收到消息吗？
A: 不能。建议 Mac 24/7 运行（NAS 场景）。

### Q: 如何获取群组 ID？
A: 运行 `npm run get-chats` 工具。

---

## 依赖

- [@photon-ai/advanced-imessage-kit](https://github.com/photon-hq/advanced-imessage-kit)

---

## 许可

MIT

---

*更新: 2026-01-09*
