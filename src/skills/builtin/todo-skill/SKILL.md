---
name: todo-skill
description: 单期动作的备忘与状态翻转能力。触发时机：用户需要管理待办任务时。
---

# 任务管理技能

## 触发时机

当用户请求涉及待办任务时触发：
- 查看任务列表
- 添加新任务
- 标记任务为完成

## 可用命令

### msgcode todo list

查看任务列表。

```bash
msgcode todo list
msgcode todo list --status pending
msgcode todo list --status done
```

| 参数 | 必填 | 说明 |
|------|------|------|
| --status | 否 | 状态过滤：pending|done |

### msgcode todo add

添加任务。

```bash
msgcode todo add --content "完成 P5.7-R3 技能开发"
```

| 参数 | 必填 | 说明 |
|------|------|------|
| --content | 是 | 任务内容 |

### msgcode todo done

标记任务为完成。

```bash
msgcode todo done --id <task-id>
```

| 参数 | 必填 | 说明 |
|------|------|------|
| --id | 是 | 任务 ID |

## 存储

- 基于 Markdown 映射（task_plan.md 或 .msgcode/todos.md）
