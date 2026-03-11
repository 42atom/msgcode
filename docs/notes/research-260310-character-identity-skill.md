# Character-Identity 基础 Skill 设计

## 问题

在群聊或其他多角色沟通场景中，模型需要回答两个问题：

1. 当前是谁在说话？
2. 之前见过的这个人是谁？

当前系统已经能拿到原始身份事实，例如：

- `channel`
- `chatId`
- `senderId`

但这还不是“人物识别能力”。

如果把人物别名、角色标注、主次关系、群内识别都做进 core，会迅速污染内核。

## 核心结论

`character-identity` 应当实现为一个 **基础 skill**，而不是 core 能力。

边界冻结如下：

- **core**：只提供原始身份事实
- **config/env**：只提供稳定配置事实（例如主人的渠道 ID）
- **character-identity skill**：维护本地人物对照表，并在忘记时主动查询

## 为什么它是基础 skill

它不是一个单点功能，而是一种可复用的沟通能力协议：

- 适用于群聊
- 适用于多角色频道
- 适用于未来 Telegram / Discord
- 适用于“我是谁 / 他是谁 / 这个 ID 对应哪个人”这类持续问题

因此它应当被视为：

**多发言人沟通场景下的基础识别 skill**

而不是飞书专用逻辑。

## 薄 core 边界

### core 负责

- 暴露当前会话的原始事实：
  - `channel`
  - `chatId`
  - `senderId`
- 暴露稳定配置事实：
  - `MSGCODE_PRIMARY_OWNER_FEISHU_IDS`
  - `MSGCODE_PRIMARY_OWNER_TELEGRAM_IDS`
  - `MSGCODE_PRIMARY_OWNER_DISCORD_IDS`
  - `MSGCODE_PRIMARY_OWNER_IMESSAGE_IDS`

### core 不负责

- 维护人物别名表
- 猜测当前发言人是谁
- 维护群成员档案
- 推断角色关系
- 做跨渠道统一人物 ID

## character-identity skill 负责

### 1. 自维护简单文本表

优先采用简单文件作为真相源：

- `csv`
- 或极简 `tsv`
- 必要时可退到 markdown table

不做数据库，不做服务。

### 2. 记录字段

建议最小字段：

- `channel`
- `chat_id`
- `sender_id`
- `alias`
- `role`
- `notes`
- `first_seen_at`
- `last_seen_at`

### 3. 触发时机

当出现以下情况时，skill 应主动更新或查询表：

- 识别到新的 `senderId`
- 用户自我介绍
  - “我是老哥”
  - “以后叫我老王”
  - “这个号是我小号”
- 模型需要判断当前发言人是谁
- 模型忘记某个 ID 对应的人物

### 4. 查询策略

当模型不确定人物身份时：

- **先查 character-identity 文件**
- 再决定是否向用户确认
- 不允许直接猜

一句话：

**忘记人物是谁时，回查本地表；查不到再问，不要脑补。**

## owner 与昵称的区别

`character-identity` 必须严格区分两类信息：

- **owner**
  - 只能来自配置里的渠道 owner IDs
  - 不是自我声明出来的
- **nickname / alias**
  - 可以来自明确自我介绍
  - 例如“我是老哥”“以后叫我老王”

冻结规则：

1. 若已配置本渠道 owner IDs，则 owner 角色只按配置匹配。
2. “我是主人”不能直接生效，只能视为 claim，不是 fact。
3. 自我介绍默认只更新 `alias / notes`，不更新 `owner`。
4. 若本渠道未配置 owner IDs，则允许该渠道处于无主人模式。

## 文件协议建议

建议每个群或会话一个文件，避免全局大表：

- `.msgcode/people/feishu-<chat-token>.csv`
- `.msgcode/people/telegram-<chat-token>.csv`
- `.msgcode/people/discord-<chat-token>.csv`

示例：

```csv
channel,chat_id,sender_id,alias,role,notes,first_seen_at,last_seen_at
feishu,feishu:oc_xxx,ou_0443f43f6047fd032302ba09cbb374c3,老哥,owner,默认主要服务对象,2026-03-10T14:19:49Z,2026-03-10T14:28:56Z
feishu,feishu:oc_xxx,ou_abc123,产品同学,member,,2026-03-11T09:00:00Z,2026-03-11T09:20:00Z
```

## 与 owner 配置的关系

owner 不是 character-identity 的替代品。

两者关系应当是：

- **owner 配置**
  - 稳定、手工配置的事实
  - 用于告诉模型“谁是默认主要服务对象”

- **character-identity**
  - 动态维护的人物对照表
  - 用于告诉模型“这个 senderId 对应谁、叫什么、是什么角色”

也就是说：

- owner 是固定配置事实
- character-identity 是会话沟通事实

## 与提示词的关系

提示词只承担“行为偏好”，不承担真相源。

例如群聊策略可以提醒模型：

- 当前发言人不是主人时，默认更保守
- 但不要因为没有 alias 就假装不知道当前是谁
- 应先依据 `senderId` 与 character-identity 查询

## 与未来渠道的关系

character-identity 的抽象应按渠道无关设计：

- Feishu
- Telegram
- Discord

只要 transport 能提供：

- `channel`
- `chatId`
- `senderId`

skill 就能工作。

因此这是一种统一的多角色沟通抽象，不是飞书私有逻辑。

## 推荐实现顺序

1. 继续保持 core 只注入原始身份事实
2. 新增 `character-identity` 基础 skill
3. 先用简单 CSV 作为真相源
4. 让 skill 支持：
   - 查询当前 senderId
   - 更新 alias/role
   - 读写本地表
5. 后续如有必要，再在提示词里补一句查询习惯

## 非目标

- 不做通讯录系统
- 不做全群成员目录同步
- 不做跨渠道主键统一
- 不做数据库
- 不做权限平台

## 一句话冻结

**character-identity 是基础 skill。**
**它解决的是多角色沟通中的人物识别与本地对照表维护。**
**core 只提供身份事实，不负责人物语义。**
