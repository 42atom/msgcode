# E03: 收消息链路（lastSeen 游标替代 unreadOnly/markAsRead）

## Goal
消灭“必须写 chat.db 才能正确收消息”的系统性依赖。

## Scope
- 每个 chatId 保存一个游标：`lastSeenRowId` 或 `lastSeenDate` 或 `lastSeenMessageId`（选一个主键）。
- 拉取策略：定长窗口（最近 N 条）+ 游标过滤 + 幂等去重。
- 状态存储：本地文件（例如 `~/.config/msgcode/state.json`）或 sqlite（只写自己的库）。

## Non-goals
- 不追求跨机器同步状态（2.0 可不做）。

## Tasks
- [ ] 选定游标字段与一致性策略（rowid 优先，其次 date）
- [ ] 实现状态读写（原子写、崩溃可恢复）
- [ ] 将 `unreadOnly` 改为“窗口 + 游标过滤”
- [ ] 下线 `markAsReadSQLite` 主路径（保留可选 cleanup 工具）
- [ ] 收敛触发源：1 主 + 1 保底（避免三路触发）

## Acceptance
- 在 iCloud 同步开启/多设备在线的情况下，仍可稳定收消息（至少不依赖写 DB）。

