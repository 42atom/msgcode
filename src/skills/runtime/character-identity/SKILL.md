---
name: character-identity
description: This skill should be used when a group or channel has multiple speakers and the model needs to identify the current speaker, maintain a workspace-local CSV table, or look up a sender by channel/chatId/senderId instead of guessing.
---

# character-identity skill

## 能力

本 skill 用于多角色沟通中的人物识别。

- 根据当前会话里的原始身份事实识别当前说话人
- 在当前 workspace 内维护一份简单文本人物表
- 忘记某个 `senderId` 对应谁时，先查表，不要猜

## 何时使用

在以下场景读取并使用本 skill：

- 当前会话有多个发言人
- 需要判断“现在是谁在说话”
- 用户说“我是老哥”“以后叫我老王”这类自我介绍
- 需要把某个 `senderId` 记成 alias / role / notes
- 模型想引用之前的人物信息，但不确定是否记对
- 当前渠道是飞书，且需要先批量拿成员 ID 和名字建立初始对照表

## 何时不要用

- 单人私聊且当前发言人身份无歧义
- 不需要记住人物别名或角色
- 只是在执行一个与人物身份无关的局部动作

## 核心边界

### core 已经提供什么

core 只负责提供原始身份事实，例如：

- `channel`
- `chatId`
- `senderId`
- 本渠道主人的 ID（若已配置）

这些是事实输入，不是人物语义。

### 本 skill 负责什么

- 维护 `senderId -> alias / role / notes`
- 记录第一次出现和最近一次出现
- 在不确定时回查本地表

### 本 skill 不负责什么

- 不做硬门禁
- 不做跨渠道统一主键
- 不做群成员目录平台
- 不把人物语义写回 core

## 真相源文件

优先使用 workspace 内简单文本文件，不要引入数据库。

推荐路径：

- `.msgcode/character-identity/<channel>-<chat-token>.csv`

例如：

- `.msgcode/character-identity/feishu-oc_xxx.csv`
- `.msgcode/character-identity/telegram-123456.csv`

## CSV 格式

默认表头：

```csv
channel,chat_id,sender_id,alias,role,notes,first_seen_at,last_seen_at
```

示例：

```csv
channel,chat_id,sender_id,alias,role,notes,first_seen_at,last_seen_at
feishu,feishu:oc_xxx,ou_0443f43f6047fd032302ba09cbb374c3,老哥,owner,默认主要服务对象,2026-03-10T14:19:49Z,2026-03-10T14:28:56Z
feishu,feishu:oc_xxx,ou_abc123,产品同学,member,,2026-03-11T09:00:00Z,2026-03-11T09:20:00Z
```

## 最小工作流

### 1. 先拿当前身份事实

优先从当前上下文读取：

- 当前渠道
- 当前 `chatId`
- 当前 `senderId`

这些事实缺失时，不要猜当前说话人是谁。

### 2. 先查本地表

用 `channel + chatId + senderId` 在当前 workspace 的 CSV 中查找：

- 找到：优先使用已有 alias / role / notes
- 找不到：继续看当前对话里是否有明确自我介绍

### 3. 只有在有明确证据时才写入或更新

允许更新的情况：

- 用户明确说“我是老哥”
- 用户明确说“以后叫我老王”
- 当前上下文已明确标出本渠道主人 ID，且当前 `senderId` 命中

不要因为语气或上下文猜测就直接写表。

这里要区分两类信息：

- `nickname / alias`
  - 可以根据用户明确自我介绍更新
- `owner`
  - 不能靠自称获得
  - 只能根据本渠道已配置的 owner IDs 判断

### 4. 忘记时先查，查不到再问

默认顺序：

1. 查 CSV
2. 再看当前对话是否有明确说明
3. 还不确定，再向用户确认

不要直接脑补人物身份。

## 写表规则

- 若文件不存在：先创建目录与 CSV 表头
- 若记录不存在：追加一行
- 若记录已存在：
  - 保留 `first_seen_at`
  - 更新 `last_seen_at`
  - 仅在有明确新证据时更新 `alias / role / notes`

## 与 owner 配置的关系

owner 配置是稳定事实，不等于人物表本身。可以使用：

- `MSGCODE_PRIMARY_OWNER_FEISHU_IDS`
- `MSGCODE_PRIMARY_OWNER_TELEGRAM_IDS`
- `MSGCODE_PRIMARY_OWNER_DISCORD_IDS`
- `MSGCODE_PRIMARY_OWNER_IMESSAGE_IDS`

作为判断 `role=owner` 的强证据，但人物表仍由本 skill 在 workspace 内维护。

冻结规则：

1. 若本渠道配置了 owner IDs，则 `owner` 角色只尊重配置匹配结果。
2. “我是主人”这类说法不能直接把当前记录升级成 `owner`。
3. “我是老哥”“以后叫我老王”这类说法，只能更新 `nickname / alias / notes`。
4. 若本渠道未配置 owner IDs，则允许处于“无主人”模式；此时不要凭空补出 owner。
5. 若当前渠道是飞书，且需要快速初始化人物表，可先调用 `feishu_list_members` 拉 `senderId + name`，再写入 CSV。

一句话：

**owner 是配置事实；昵称才允许靠自我介绍更新。**

## 常见错误

- ❌ 把人物识别做成 core 逻辑
- ❌ 没查表就猜人物身份
- ❌ 只按 alias 查，不按 `senderId` 查
- ❌ 试图做跨渠道统一人物 ID
- ❌ 把整个群成员目录平台化

## 一句话原则

**人物识别先看 `senderId`，忘记就查当前 workspace 的 CSV；查不到再问，不要猜。**
