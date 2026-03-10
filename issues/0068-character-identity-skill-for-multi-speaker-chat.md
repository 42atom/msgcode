---
id: 0068
title: 群聊多角色人物识别 character-identity 基础 skill
status: open
owner: agent
labels: [feature, docs]
risk: low
scope: 将多发言人身份识别收口为 skill，不污染 core
links: []
---

## Context

当前飞书入站链已经拿到了稳定的 `senderId`，但模型侧仍缺少一套统一的“多发言人识别与对照表”能力。

这类能力如果直接进 core，会把人物别名、角色识别、群内关系维护、跨渠道映射都焊进内核，违背薄 core 原则。

因此需要冻结一条后续实现边界：

- core 只提供原始身份事实
- character-identity 作为基础 skill 自维护简单文本对照表
- 提示词只负责行为偏好，不承担人物真相源

## Goal / Non-Goals

### Goal

- 明确 character-identity 的职责边界与文件真相源
- 明确多角色群聊场景下的最小可行实现
- 明确与 owner 配置、原始 senderId、未来 Telegram/Discord 的关系

### Non-Goals

- 本 issue 不实现 character-identity skill
- 不把 alias / 角色识别 / 允许名单写进 core
- 不引入权限平台或群成员目录平台
- 不要求跨渠道统一人物 ID

## Plan

- [ ] 写一份 research/设计说明，冻结 character-identity 作为基础 skill 的口径
- [ ] 明确文件格式：简单 CSV/文本表优先
- [ ] 明确 core 只暴露 `channel/chatId/senderId` 等原始事实
- [ ] 明确 skill 在“忘记人物是谁”时应回查本地表，而不是猜测
- [ ] 后续如实施，再单独开实现 plan

## Acceptance Criteria

- 有一份可引用的正式说明文档
- 文档明确区分：
  - core 原始身份事实
  - owner 配置事实
  - character-identity skill 维护的人物表
- 文档明确 character-identity 是群聊/多角色沟通的基础 skill
- 文档明确真相源以简单文件优先，不做平台化

## Notes

- 相关背景：
  - `MSGCODE_PRIMARY_OWNER_<CHANNEL>_IDS` 已作为稳定配置事实进入主线
  - 当前 message 链已可把 `senderId` 与按渠道 owner ids 注入统一上下文

## Links

- `docs/notes/research-260310-thin-core-plugin-topology.md`
