---
name: schedule
description: 调度任务管理。触发时机：添加定时任务/查看调度/删除调度。
---

# 调度管理 (schedule)

## 触发时机

- 添加定时/周期任务
- 查看调度列表
- 删除调度任务

## 命令列表

| 命令 | 说明 |
|------|------|
| `msgcode schedule add --name <name> --cron <expr> --cmd <cmd>` | 添加调度 |
| `msgcode schedule list` | 调度列表 |
| `msgcode schedule remove --id <job-id>` | 删除调度 |

## 示例

```bash
# 添加每日备份任务
msgcode schedule add --name "每日备份" --cron "0 2 * * *" --cmd "msgcode backup run"

# 查看调度列表
msgcode schedule list
```
