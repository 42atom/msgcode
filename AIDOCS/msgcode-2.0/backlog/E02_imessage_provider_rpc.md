# E02: iMessage Provider（imsg rpc 作为主 I/O）

## Goal
用 `imsg rpc` 统一收/发接口，让 iMessage I/O 从业务逻辑中剥离出来。

## Scope
- 实现 `imsg rpc` 的 JSON-RPC client（spawn + stdio），作为 iMessage I/O 的唯一入口。
- 收消息：`watch.subscribe` 推送事件流（主路径）。
- 发消息：`send`（支持 `chat_guid`）。
- 约束：2.0 主链路不保留 SDK/AppleScript fallback（直接收口）。

## Non-goals
- 不在这个 Epic 内解决 tmux/Claude 输出解析。

## Tasks
- [x] 实现 `ImsgRpcClient`（spawn + JSON-RPC client）
- [x] listener 入口消费 `watch.subscribe` 事件流
- [x] 发送入口统一走 RPC `send`
- [x] probe/status 支撑：可探测 `imsg rpc` 是否可用（见 E15）

## Acceptance
- 群聊发送不再走 AppleScript 主路径（至少在方案 B）。
- 收消息不再依赖 unreadOnly/markAsRead（与 E03 联动）。
