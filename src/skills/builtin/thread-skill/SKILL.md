---
name: thread-skill
description: 多线程会话的感知与切换能力。触发时机：用户需要查看线程列表、切换线程、查看历史消息时。
---

# 线程管理技能

## 触发时机

当用户请求涉及会话线程时触发：
- 查看线程列表
- 查看指定线程的消息
- 切换到指定线程
- 查询当前激活的线程

## 可用命令

### msgcode thread list

查看线程列表。

```bash
msgcode thread list --limit 10
```

| 参数 | 必填 | 说明 |
|------|------|------|
| --limit | 否 | 返回数量限制 |

### msgcode thread messages

查看指定线程的消息。

```bash
msgcode thread messages --id <thread-guid> --limit 20
```

| 参数 | 必填 | 说明 |
|------|------|------|
| --id | 是 | 线程 GUID |
| --limit | 否 | 返回数量限制 |

### msgcode thread switch

切换到指定线程。

```bash
msgcode thread switch --id <thread-guid>
```

返回：
```json
{ "active_thread": { "id": "...", "title": "...", "last_active": "..." } }
```

### msgcode thread active

查询当前激活的线程。

```bash
msgcode thread active
```

## 依赖

- src/state/store.ts
