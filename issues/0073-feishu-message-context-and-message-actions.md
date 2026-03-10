---
id: 0073
title: 飞书消息级上下文与消息动作能力收口
status: doing
owner: agent
labels: [feature, refactor, docs]
risk: medium
scope: 收口飞书群聊中的消息级事实、最近消息结构、引用回复与 reaction 动作能力
plan_doc: docs/design/plan-260311-feishu-message-context-and-actions.md
links:
  - docs/design/plan-260311-feishu-message-context-and-actions.md
  - docs/tasks/p6-feishu-message-context-and-actions-dispatch-pack.md
  - src/feishu/transport.ts
  - src/runtime/context-policy.ts
  - src/runtime/thread-store.ts
---

## Context

当前飞书群聊里，系统已经能拿到 `senderId` 和 `messageId`，但只有 `senderId` 进入了 LLM 上下文。结果是：

- 模型知道“谁在说话”，不知道“具体哪条消息”
- 不能稳定引用某条消息
- 不能稳定对某条消息做 reaction
- 历史窗口只保留 `role + content`，缺少消息级结构

同时，现有工具层只有：

- `feishu_list_members`
- `feishu_send_file`

还没有：

- 最近消息只读查询
- 指向具体 `messageId` 的 reply/reaction 动作

## Goal / Non-Goals

### Goal

- 给模型补齐最小必要的消息级事实
- 提供最近消息的结构化视图，而不是全量历史全文注入
- 为引用回复与 reaction 准备统一的消息级动作主链
- 保持 `character-identity` 继续做人物语义，不把人物系统焊进 core

### Non-Goals

- 不做消息平台
- 不做全量消息历史注入
- 不做第二套事件总线
- 不把权限/人物识别系统平台化
- 不顺手扩到 Telegram / Discord

## Plan

- [x] Phase 1：当前消息 facts 注入上下文
- [x] Phase 2：最近消息结构化摘要收口
- [x] Phase 3：最近消息只读工具
- [x] Phase 4：消息级动作工具（reply / react）
- [x] 补测试、更新 changelog 与验证记录（Phase 1-3）

## Acceptance Criteria

- 当前飞书消息的 `messageId` 能进入 LLM 上下文
- 模型能看到最近若干条消息的结构化最小信息，而不是只能靠纯文本记忆
- 引用回复与 reaction 都以 `messageId` 为目标，而不是猜测“上一条”
- 不新增平台层，不把全量历史消息塞进 context

## Notes

- 当前代码证据：
  - `src/feishu/transport.ts` 已有 `message_id -> InboundMessage.id`
  - `src/runtime/context-policy.ts` 当前只注入 speaker identity，不注入 current message identity
  - `src/runtime/thread-store.ts` 当前只保留 turn 文本，不保留消息级结构
- 当前日志证据：
  - `/Users/admin/.config/msgcode/log/msgcode.log`
  - 多条 Feishu 入站日志已包含 `messageId=om_xxx`
  - 模型在群聊里明确表示“没有发消息、点赞相关能力”
- 2026-03-11 Phase 1 已实现：
  - `currentMessageId`
  - `currentSpeakerName`
  - `currentIsGroup`
  - `currentMessageType`
  - `defaultActionTargetMessageId`
  已进入统一 context policy，并通过专项测试验证。
- 2026-03-11 Phase 2 已实现：
  - `session-window` 现在会为用户消息保留：
    - `messageId`
    - `senderId`
    - `senderName`
    - `messageType`
    - `isGroup`
  - `context-policy` 会基于最近窗口生成 `[最近消息索引]`
  - 最近消息索引只保留最小结构：
    - `messageId`
    - `senderId`
    - `senderName`
    - `messageType`
    - `textSnippet`
    - `isFromPrimaryOwner`
  - 验证：
    - `bun test test/p6-feishu-message-context-phase2.test.ts`
    - `bun test test/p6-feishu-message-context-phase1.test.ts test/p6-agent-run-core-phase3-context-policy.test.ts test/p5-7-r31-primary-owner-channel-config.test.ts`
- 2026-03-11 Phase 3 已实现：
  - 新增只读工具 `feishu_list_recent_messages`
  - 支持按 `chatId` 或当前 workspace 会话上下文回填群聊
  - 返回最近若干条消息的最小结构表：
    - `messageId`
    - `senderId`
    - `messageType`
    - `sentAt`
    - `replyToMessageId`
    - `textSnippet`
  - 群聊权限不足时，会明确提示需要飞书后台开启“获取群组中所有消息”权限
  - 现有 workspace 默认 allow 与 `/tool allow` 用户口径已同步补上
  - 验证：
    - `bun test test/p6-feishu-message-context-phase3-tool.test.ts test/p5-6-8-r4g-pi-core-tools.test.ts test/tools.bus.test.ts test/p5-7-r3n-system-prompt-file-ref.test.ts`
- 2026-03-11 Phase 4 已实现：
  - 新增消息级动作工具：
    - `feishu_reply_message`
    - `feishu_react_message`
  - 两者都支持：
    - 显式 `messageId`
    - 若用户说的是“本消息”，则回落到当前上下文中的 `defaultActionTargetMessageId`
  - `reply` 主链支持：
    - `text`
    - `replyInThread`
  - `react` 主链支持：
    - 常见 emoji alias（如 `+1` / `like` / `点赞` -> `THUMBSUP`）
  - 默认 workspace allow、`/tool allow` 用户口径与系统提示词已同步补上
  - 验证：
    - `bun test test/p6-feishu-message-context-phase4-actions.test.ts test/p6-feishu-message-context-phase3-tool.test.ts test/p5-6-8-r4g-pi-core-tools.test.ts test/tools.bus.test.ts test/p5-7-r3n-system-prompt-file-ref.test.ts`

## Links

- [src/feishu/transport.ts](/Users/admin/GitProjects/msgcode/src/feishu/transport.ts)
- [src/runtime/context-policy.ts](/Users/admin/GitProjects/msgcode/src/runtime/context-policy.ts)
- [src/runtime/thread-store.ts](/Users/admin/GitProjects/msgcode/src/runtime/thread-store.ts)
- [docs/design/plan-260311-feishu-message-context-and-actions.md](/Users/admin/GitProjects/msgcode/docs/design/plan-260311-feishu-message-context-and-actions.md)
- [docs/tasks/p6-feishu-message-context-and-actions-dispatch-pack.md](/Users/admin/GitProjects/msgcode/docs/tasks/p6-feishu-message-context-and-actions-dispatch-pack.md)
