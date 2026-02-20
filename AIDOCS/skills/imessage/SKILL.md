---
name: imessage
description: iMessage 消息发送能力。触发：发送消息/发送文件/发送图片到 iMessage 会话。
---

# iMessage 发送 (imessage)

## 触发时机

- 发送文本消息到 iMessage
- 发送文件/图片到 iMessage
- 列出 iMessage 会话
- 查询当前会话

## 命令列表

| 命令 | 说明 |
|------|------|
| `msgcode imsg send --text <text> [--to <chat-id>]` | 发送文本 |
| `msgcode imsg send-file --path <path> [--to <chat-id>] [--caption <text>]` | 发送文件/图片 |
| `msgcode imsg list-chats [--limit <n>]` | 列出会话 |
| `msgcode imsg current-chat` | 查询当前会话 |

## 示例

```bash
# 发送文本到当前会话
msgcode imsg send --text "你好，这是测试消息"

# 发送图片到指定会话
msgcode imsg send-file --path ~/Desktop/photo.jpg --to chat-123

# 发送文件并带说明文字
msgcode imsg send-file --path ./report.pdf --caption "请查收报告"

# 查看最近会话列表
msgcode imsg list-chats --limit 10
```

## 参数说明

| 参数 | 必填 | 说明 |
|------|------|------|
| --text | 是 (send) | 要发送的文本 |
| --path | 是 (send-file) | 文件路径 |
| --to | 否 | 目标会话 ID，不填则发送到当前会话 |
| --caption | 否 | 附加说明文字 |
| --limit | 否 | 返回数量限制 |

## 依赖

- iMessage RPC 客户端
