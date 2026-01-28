# E04: 发送链路统一（DM/群聊同构 + 重试策略集中）

## Goal
把“发送”从多个分支（SDK/AppleScript/sqlite 回执）收敛成一个可控状态机。

## Scope
- 单入口：`sendMessage(target, text, attachments?)`
- 分片/截断规则统一（iMessage 字数限制）
- 超时/重试/错误码统一

## Tasks
- [ ] 统一 target 类型（群聊/私聊）
- [ ] 统一分片策略与最大长度
- [ ] 统一重试策略：什么能重试、冷却窗口、如何避免重复刷屏
- [ ] 发送结果：尽量返回可追踪 id（messageId/guid 或内部 requestId）

## Acceptance
- 发送相关日志字段一致，可做统计（成功率、重试率、失败原因 TopN）。

