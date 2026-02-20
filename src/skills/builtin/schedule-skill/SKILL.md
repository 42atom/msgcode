---
name: schedule-skill
description: 周期或延时任务的调度能力。触发时机：用户需要管理定时任务/周期任务时。
---

# 调度管理技能

## 触发时机

当用户请求涉及定时/周期任务时触发：
- 添加调度任务
- 查看调度列表
- 删除调度任务

## 可用命令

### msgcode schedule add

添加调度任务。

```bash
msgcode schedule add --name "每日备份" --cron "0 2 * * *" --cmd "msgcode backup run"
```

| 参数 | 必填 | 说明 |
|------|------|------|
| --name | 是 | 任务名称 |
| --cron | 是 | Cron 表达式 |
| --cmd | 是 | 要执行的命令 |

### msgcode schedule list

查看调度列表。

```bash
msgcode schedule list
```

### msgcode schedule remove

删除调度任务。

```bash
msgcode schedule remove --id <job-id>
```

| 参数 | 必填 | 说明 |
|------|------|------|
| --id | 是 | 任务 ID |

## 依赖

- src/jobs/store.ts (cron jobs)
