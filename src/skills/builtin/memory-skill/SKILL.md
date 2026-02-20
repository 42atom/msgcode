---
name: memory-skill
description: 长期记忆的检索与固化能力。触发时机：用户需要搜索记忆、添加记忆、查看记忆统计时。
---

# 记忆管理技能

## 触发时机

当用户请求涉及长期记忆时触发：
- 搜索/检索记忆
- 添加新的记忆
- 查看记忆统计信息

## 可用命令

### msgcode memory search

语义检索记忆。

```bash
msgcode memory search --q "用户认证流程" --limit 5
```

| 参数 | 必填 | 说明 |
|------|------|------|
| --q | 是 | 搜索查询 |
| --limit | 否 | 返回数量限制 |

### msgcode memory add

添加记忆。

```bash
msgcode memory add --content "认证使用 JWT token，有效期 24 小时"
msgcode memory add --content "项目使用 TypeScript" --tags "tech,typescript"
```

| 参数 | 必填 | 说明 |
|------|------|------|
| --content | 是 | 记忆内容 |
| --tags | 否 | 标签，逗号分隔 |

### msgcode memory stats

查看记忆统计。

```bash
msgcode memory stats
```

## 依赖

- sqlite-vec + FTS 语义检索
