---
name: todo
description: 待办任务管理。触发时机：添加任务/查看列表/完成任务。
---

# 任务管理 (todo)

## 触发时机

- 添加新任务
- 查看任务列表
- 标记任务完成

## 命令列表

| 命令 | 说明 |
|------|------|
| `msgcode todo list [--status pending|done]` | 任务列表 |
| `msgcode todo add --content <text>` | 添加任务 |
| `msgcode todo done --id <task-id>` | 完成任务 |

## 示例

```bash
# 查看待办任务
msgcode todo list --status pending

# 添加任务
msgcode todo add --content "完成 P5.7-R3 开发"

# 完成任务
msgcode todo done --id task-001
```
