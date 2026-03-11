---
name: reactions
description: This skill should be used when the user explicitly wants to react to a message with an emoji and the current runtime already has a local reaction bridge endpoint available.
---

# reactions skill

## 能力

对已有消息添加表情反应。

## 何时使用

- 用户明确要求“点个赞”“加个表情”“react 一下”
- 当前运行环境确实存在本地 reaction bridge

## 边界

这不是 msgcode 当前默认 core 能力。

只有在当前环境已提供本地 reaction bridge 时才使用；如果没有该桥接能力，要直接说明当前环境不支持，不要假装已经反应成功。

## 调用合同

当前约定的本地桥接接口是 HTTP：

- Telegram / 通用：
  - `POST http://localhost:23001/api/reaction/set`
- Discord：
  - `POST http://localhost:23001/api/discord/reaction`
- Feishu：
  - `POST http://localhost:23001/api/feishu/messages/<msg-id>/reaction`

## 参考命令

```bash
curl -s -X POST http://localhost:23001/api/feishu/messages/MSG_ID/reaction \
  -H 'Content-Type: application/json' \
  -d '{"emoji":"THUMBSUP"}'
```

## 常见错误

- 不要在没有 bridge 的环境里硬调
- 不要把“回复一条文字”误当成“加表情反应”
- 不要在不知道 `messageId` 时瞎猜目标消息
