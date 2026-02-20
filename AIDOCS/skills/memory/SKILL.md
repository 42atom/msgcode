---
name: memory
description: 长期记忆的检索与固化。触发时机：搜索记忆/添加记忆/查看统计。
---

# 记忆管理 (memory)

## 触发时机

- 搜索/检索记忆
- 添加新的记忆
- 查看记忆统计

## 命令列表

| 命令 | 说明 |
|------|------|
| `msgcode memory search --q <query> [--limit <n>]` | 语义检索 |
| `msgcode memory add --content <text> [--tags <tags>]` | 添加记忆 |
| `msgcode memory stats` | 查看统计 |

## 示例

```bash
# 搜索认证相关记忆
msgcode memory search --q "用户认证流程" --limit 5

# 添加技术栈记忆
msgcode memory add --content "项目使用 TypeScript + Node.js" --tags "tech"
```
