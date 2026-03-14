# 飞书消息级上下文与消息动作能力方案

## Problem

当前飞书群聊主链有三处断裂：

1. transport 已拿到 `messageId`，但 LLM 上下文里没有 `currentMessageId`
2. 最近消息窗口只有 `role + content`，没有消息级结构，无法精确定位“哪条消息”
3. 工具层只有 `feishu_list_members` / `feishu_send_file`，没有消息级 reply / reaction 能力

结果是：

- 模型只能知道“谁说的”，不能知道“哪条消息”
- 无法精确引用
- 无法精确 reaction

## Occam Check

- 不加它，系统具体坏在哪？
  群聊继续只能做人物识别，无法精确定位消息，也无法对“本消息/上一条消息/某人的那条消息”执行引用和 reaction。
- 用更少的层能不能解决？
  能。只补消息级事实、结构化最近消息和最小动作工具，不新增消息平台。
- 这个改动让主链数量变多了还是变少了？
  变少了。把“猜测上一条消息”的隐式路径，收口成统一的消息级事实与动作主链。

## Decision

采用分 4 阶段的最薄方案：

1. **先补当前消息 facts**
2. **再补最近消息结构**
3. **再补只读消息工具**
4. **最后补 reply/react 动作手臂**

关键原则：

- 当前消息 facts 永远给全
- 历史消息只给结构化摘要，不给全量全文
- 更早历史按需查
- 人物语义继续由 `character-identity` 负责

## 设计

### Phase 1：当前消息 facts

每轮进入模型前，统一注入：

- `currentChannel`
- `currentChatId`
- `currentMessageId`
- `currentSenderId`
- `currentSenderName`（有则给）
- `currentIsGroup`
- `currentMessageType`
- `currentText`
- `currentSentAt`（有则给）
- `defaultActionTargetMessageId = currentMessageId`

目标：

- 让“对本消息点赞”“引用这条消息回复”这类表达有唯一默认目标

### Phase 2：最近消息结构化摘要

在 context policy 中补一个最近消息最小结构表，建议只保留最近 `5~10` 条，字段包括：

- `messageId`
- `senderId`
- `senderName`
- `textSnippet`
- `sentAt`
- `messageType`
- `isFromPrimaryOwner`
- `replyToMessageId`（若有）

原则：

- 给结构，不给全量长全文
- 这是给 LLM 的“可定位 roster”，不是聊天记录平台

### Phase 3：最近消息只读工具

新增最薄只读工具，例如：

- `feishu_list_recent_messages`

输入：

- `chatId`
- `limit`
- 可选 `senderId`

输出：

- 最近若干条消息的最小结构表

目标：

- 当最近消息摘要不够时，模型可按需查

### Phase 4：消息级动作工具

拆成两条，不混：

- `feishu_reply_message`
  - `messageId`
  - `text`
- `feishu_react_message`
  - `messageId`
  - `emoji`

原则：

- 一切动作都显式以 `messageId` 为目标
- 不再猜“上一条”
- 不把 `reactions` skill 当成默认 core 手臂

## Plan

### Phase 1：补当前消息 facts

建议落点：

- `src/runtime/context-policy.ts`
- `src/handlers.ts`
- `src/commands.ts`（如 task/message 共用装配器需要同步）
- 测试：新增 message facts 注入专项锁

验收：

- 普通消息链里 LLM 可见 `currentMessageId`
- prompt/context 中能看到 `defaultActionTargetMessageId`

### Phase 2：补最近消息结构化摘要

建议落点：

- `src/runtime/thread-store.ts`
- `src/runtime/context-policy.ts`
- 相关测试

验收：

- 最近消息结构表进入上下文
- 不丢当前 Phase 3 已收口的 context policy 主链

### Phase 3：补只读消息工具

建议落点：

- `src/tools/manifest.ts`
- `src/tools/bus.ts`
- 新增 `src/tools/feishu-list-recent-messages.ts`
- 飞书 transport 或 API 适配层

验收：

- 模型可按 chatId 拉最近消息
- 返回字段稳定、最小

### Phase 4：补动作工具

建议落点：

- `src/tools/manifest.ts`
- `src/tools/bus.ts`
- 新增 `feishu-reply-message.ts`
- 新增 `feishu-react-message.ts`
- prompts / tests

验收：

- 引用回复与 reaction 都以 `messageId` 为目标
- 模型不再说“没有具体消息能力”

## Risks

- 风险 1：把历史消息注入过多，导致上下文膨胀
  - 缓解：只给结构化最近消息，不给全量全文
- 风险 2：动作工具先于消息事实落地，导致模型仍然猜目标
  - 缓解：严格按阶段推进，先 facts 再动作
- 风险 3：reply/react API 细节可能受飞书能力边界影响
  - 缓解：Phase 4 之前先只做 facts + read path，不提前承诺动作主链

## Rollback

- 回退 message facts 注入
- 回退 recent message roster 注入
- 回退新增的只读/动作工具
- 保留现有人物识别和群成员能力不动

评审意见：[留空,用户将给出反馈]
