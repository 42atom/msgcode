# E02: iMessage Provider（imsg rpc 作为主 I/O）

## Goal
用 `imsg rpc` 统一收/发接口，让 iMessage I/O 从业务逻辑中剥离出来。

## Scope
- Provider 接口：`start()`/`stop()`/`send()`/`probe()`/`onMessage(cb)`。
- 收消息：`watch.subscribe` 推送事件流（主路径）。
- 发消息：`method=send`（支持群聊目标 `chat_id/chat_guid/...`）。
- 兼容：保留现有 SDK/AppleScript 作为 fallback（迁移期）。

## Non-goals
- 不在这个 Epic 内解决 tmux/Claude 输出解析。

## Tasks
- [ ] 定义 `IMessageProvider` 接口（强类型目标：chat_id/chat_guid/handle）
- [ ] 实现 `ImsgRpcProvider`（spawn + JSON-RPC client）
- [ ] 把现有 listener 的“收消息入口”改为消费 provider 事件
- [ ] 把“发送入口”改为走 provider（先群聊，再私聊）
- [ ] 定义 fallback 条件（rpc 不可用/权限不足/超时）

## Acceptance
- 群聊发送不再走 AppleScript 主路径（至少在方案 B）。
- 收消息不再依赖 unreadOnly/markAsRead（与 E03 联动）。

