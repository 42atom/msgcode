# 飞书消息级上下文与消息动作能力派发包

## 任务一句话

把飞书群聊从“只知道谁在说话”升级到“知道具体哪条消息，并能对消息执行引用回复与 reaction”。

## 唯一真相源

- Issue:
  - [0073-feishu-message-context-and-message-actions.md](/Users/admin/GitProjects/msgcode/issues/0073-feishu-message-context-and-message-actions.md)
- Plan:
  - [plan-260311-feishu-message-context-and-actions.md](/Users/admin/GitProjects/msgcode/docs/plan/pl0073.dne.feishu.feishu-message-context-and-message-actions.md)

## 核心原则

1. 当前消息 facts 全给
2. 历史消息只给结构化摘要
3. 更早历史按需查
4. 人物语义继续交给 `character-identity`
5. 一切消息动作都显式依赖 `messageId`

## 分阶段

### Phase 1：当前消息 facts

目标：

- 注入 `currentMessageId`
- 注入 `defaultActionTargetMessageId`

硬验收：

1. 当前飞书消息进入模型时，能看到 `currentMessageId`
2. “本消息”有唯一默认目标

### Phase 2：最近消息结构化摘要

目标：

- 最近 `5~10` 条消息进入上下文的最小结构表

硬验收：

1. 可见 `messageId + senderId + textSnippet`
2. 不引入全量历史全文注入

### Phase 3：只读消息工具

目标：

- 新增 `feishu_list_recent_messages`

硬验收：

1. 可按 chat 查询最近消息
2. 返回字段稳定且最小

### Phase 4：消息级动作工具

目标：

- `feishu_reply_message`
- `feishu_react_message`

硬验收：

1. reply/react 都显式吃 `messageId`
2. 不再猜“上一条”

## 非范围 / 禁止扩 scope

- 不做消息平台
- 不做全量消息同步
- 不做第二套事件总线
- 不做 Telegram / Discord
- 不把人物识别焊进 core

## 已知坑

1. 当前 transport 已有 `messageId`，但 context policy 未注入
2. 当前 thread store 只有 turn 文本，没有消息级结构
3. 当前 `reactions` 只是 optional skill，不是默认飞书动作手臂
4. 当前动作工具缺失时，模型会退回“无法引用/无法点赞”

## 交付格式

执行同学回传时必须包含：

- 任务
- 本轮覆盖哪个 Phase
- 改动文件
- 验证命令
- 结果
- 风险 / 未覆盖项

## 派单正文（可直接转发）

```text
给执行同学：

任务：按 Phase 顺序推进飞书消息级上下文与消息动作能力，先从 Phase 1 开始，不要跨阶段大爆炸。

唯一真相源：
- Issue: /Users/admin/GitProjects/msgcode/issues/0073-feishu-message-context-and-message-actions.md
- Plan: /Users/admin/GitProjects/msgcode/docs/plan/pl0073.dne.feishu.feishu-message-context-and-message-actions.md
- Task: /Users/admin/GitProjects/msgcode/docs/tasks/p6-feishu-message-context-and-actions-dispatch-pack.md

本轮范围：
- 只做 Phase 1：当前消息 facts
- 给普通飞书消息链补 currentMessageId / defaultActionTargetMessageId
- 不碰 Phase 2-4

非范围：
- 不做消息列表工具
- 不做 reaction / reply
- 不做 Telegram / Discord
- 不重构 character-identity

硬要求：
1. transport 已有的 messageId 必须真正进入 LLM 上下文
2. 只做最薄 facts 注入，不做第二套平台
3. 不允许把历史消息全文塞进 context

实现顺序：
1. 找出 transport -> context-policy 的断点
2. 补 currentMessageId / defaultActionTargetMessageId
3. 补最小专项测试

硬验收：
1. 普通消息链能看到 currentMessageId
2. 上下文里存在 defaultActionTargetMessageId
3. 现有 run/session/context policy 主链不回退

交付格式：
- 给验收同学：
  - 任务
  - 原因
  - 过程
  - 结果
  - 验证
  - 风险 / 卡点
  - 后续
```
