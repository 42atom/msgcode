---
name: agent-skill
description: 派发长程任务给领域代理的能力。触发时机：用户需要委派复杂任务给专业代理时。
---

# 代理任务技能

## 触发时机

当用户请求涉及复杂长程任务时触发：
- 运行编码代理（coding-agent）
- 运行研究代理（researcher）
- 查询代理任务状态

## 可用命令

### msgcode agent run

派发代理任务。

```bash
# 同步模式
msgcode agent run --role coder --dir . --prompt "实现一个文件搜索功能"

# 异步模式
msgcode agent run --role coder --dir . --prompt "重构整个项目" --async
# 返回：{ task_id: "abc123", status: "running" }
```

| 参数 | 必填 | 说明 |
|------|------|------|
| --role | 是 | 代理角色：coder\|researcher |
| --dir | 是 | 工作目录 |
| --prompt | 是 | 任务描述 |
| --async | 否 | 异步模式 |

### msgcode agent status

查询代理任务状态。

```bash
msgcode agent status --id abc123
```

| 参数 | 必填 | 说明 |
|------|------|------|
| --id | 是 | 任务 ID |

## 任务状态

- `pending`: 任务排队中
- `running`: 执行中
- `completed`: 完成
- `failed`: 失败
- `cancelled`: 被取消

## 依赖

- coding-agent (编码代理)
- researcher (研究代理)
