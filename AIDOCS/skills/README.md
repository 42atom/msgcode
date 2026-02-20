# msgcode Skills 索引

## 概述

msgcode 内建技能列表，按领域分类。

## 技能列表

| 技能名 | 域 | 说明 | 触发时机 |
|--------|-----|------|----------|
| [file](file/SKILL.md) | R3 | 文件操作 | 搜索/读取/写入/移动/删除/复制/压缩文件 |
| [memory](memory/SKILL.md) | R4 | 记忆管理 | 搜索记忆/添加记忆/查看统计 |
| [thread](thread/SKILL.md) | R4 | 线程管理 | 查看列表/切换线程/查看消息 |
| [todo](todo/SKILL.md) | R5 | 任务管理 | 添加任务/查看列表/完成任务 |
| [schedule](schedule/SKILL.md) | R5 | 调度管理 | 添加定时任务/查看调度/删除调度 |
| [media](media/SKILL.md) | R6 | 媒体感知 | 屏幕截图 |
| [gen](gen/SKILL.md) | R6 | 内容生成 | 生成图片/语音/音乐 |
| [browser](browser/SKILL.md) | R7 | 浏览器自动化 | 打开网页/点击/输入文本 |
| [agent](agent/SKILL.md) | R8 | 代理任务 | 运行编码代理/研究代理/查询状态 |

## 按域分组

### R3: 文件与环境域
- `file` - 文件管理

### R4: 记忆与状态域
- `memory` - 记忆管理
- `thread` - 线程管理

### R5: 编排与调度域
- `todo` - 任务管理
- `schedule` - 调度管理

### R6: 多模态感知与生成域
- `media` - 媒体感知
- `gen` - 内容生成

### R7: 高阶环境域
- `browser` - 浏览器自动化

### R8: 代理域
- `agent` - 代理任务

## 技能文件格式

每个技能是一个 `SKILL.md` 文件，包含：

```markdown
---
name: <技能名>
description: <触发描述>
---

# 技能名称

## 触发时机
...

## 命令列表
...

## 示例
...
```

## 如何使用

模型根据用户请求匹配技能的 `description` 和 `触发时机`，然后调用相应的 `msgcode <domain> <action>` 命令。

## 设计文档

- [CLI 命令设计草案](../cli_command_design.md)
