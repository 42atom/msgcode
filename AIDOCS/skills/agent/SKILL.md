---
name: agent
description: 代理任务委派。触发时机：运行编码代理/研究代理/查询状态。
---

# 代理任务 (agent)

## 触发时机

- 运行编码代理
- 运行研究代理
- 查询任务状态

## 命令列表

| 命令 | 说明 |
|------|------|
| `msgcode agent run --role <role> --dir <dir> --prompt <prompt> [--async]` | 运行代理 |
| `msgcode agent status --id <task-id>` | 查询状态 |

## 代理角色

- `coder`: 编码代理
- `researcher`: 研究代理

## 任务状态

- `pending`: 排队中
- `running`: 执行中
- `completed`: 完成
- `failed`: 失败
- `cancelled`: 取消

## 示例

```bash
# 同步运行编码代理
msgcode agent run --role coder --dir . --prompt "实现文件搜索功能"

# 异步运行
msgcode agent run --role coder --dir . --prompt "重构项目" --async

# 查询状态
msgcode agent status --id abc123
```
