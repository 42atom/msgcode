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
| [roundtable](roundtable/SKILL.md) | R9 | 多视角决策 | 自动选角讨论/风险压力测试/共识收敛 |

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

### R9: 决策分析域
- `roundtable` - 多视角决策

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

## 命令列表或执行流程
...

## 示例
...
```

## 如何使用

模型根据用户请求匹配技能的 `description` 和 `触发时机`，然后执行对应流程。命令型技能调用 `msgcode <domain> <action>`；方法型技能按 `SKILL.md` 的步骤与模板产出结果。

## 设计文档

- [CLI 命令设计草案](../cli_command_design.md)
