---
name: thread
description: 多线程会话管理。触发时机：查看线程列表/切换线程/查看消息。
---

# 线程管理 (thread)

## 触发时机

- 查看线程列表
- 切换线程
- 查看历史消息
- 查询当前线程

## 命令列表

| 命令 | 说明 |
|------|------|
| `msgcode thread list [--limit <n>]` | 线程列表 |
| `msgcode thread messages --id <guid> [--limit <n>]` | 查看消息 |
| `msgcode thread switch --id <guid>` | 切换线程 |
| `msgcode thread active` | 当前线程 |

## 示例

```bash
# 查看最近 10 个线程
msgcode thread list --limit 10

# 切换到指定线程
msgcode thread switch --id abc-123-def
```
