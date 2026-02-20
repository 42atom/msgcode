---
name: system
description: 系统信息查询。触发：查看系统信息/环境配置/机器状态。
---

# 系统信息 (system)

## 触发时机

- 查看系统信息
- 查看环境变量
- 查看机器配置

## 命令列表

| 命令 | 说明 |
|------|------|
| `msgcode system info [--json]` | 系统信息 |
| `msgcode system env [--key <name>]` | 环境变量 |

## 示例

```bash
# 查看系统信息
msgcode system info

# 查看指定环境变量
msgcode system env --key MSGCODE_HOME

# 查看所有环境变量
msgcode system env
```
