# Moltbot vs msgcode：iMessage 处理对比评估（2026-01-28）

> 目标：比较 Moltbot 项目与 msgcode 项目对 iMessage 的“收/发/权限/可靠性/可维护性”实现手段，并给出 msgcode 的可落地改进方向。

## TL;DR（结论先行）

- **Moltbot 的核心手段**：把 iMessage 抽象成「外部 CLI `imsg`」的 **JSON-RPC over stdio**，用 `watch.subscribe` 获得 **推送式事件流**，用同一 RPC `send` 覆盖 DM/群聊发送；附件通过路径透传并在需要时用 SCP 拉取远端附件。
- **msgcode 的核心手段**：依赖 `@photon-ai/imessage-kit` 的 watcher/轮询获取未读消息，**群聊发送用 AppleScript**（SDK 不支持群发），并通过 **写 chat.db 标记已读** 来驱动 `unreadOnly` 的消息流水线；为保证 DB 写一致性，README 强制要求关闭 iCloud 消息同步。
- **关键判断**：msgcode 目前把“消息发现”绑定在「已读状态」上，导致必须写 DB → iCloud 同步/多设备/权限/锁冲突都变成系统性风险；Moltbot 把“消息发现”绑定在「事件流 + 自己的状态机」上，复杂度更低、可靠性更高。

## 证据索引（读代码的落点）

### Moltbot（当前仓库）

- RPC 客户端：`src/imessage/client.ts`
  - `spawn(cliPath, ["rpc", ...])`，按行 JSON 解析，支持请求/响应与通知回调。
- 监控主循环：`src/imessage/monitor/monitor-provider.ts`
  - `watch.subscribe` → `onNotification(method="message")` → inbound debouncer/路由/权限/mention gating/历史拼装/dispatch。
- 发送：`src/imessage/send.ts`
  - RPC `send`，支持 `chat_id/chat_guid/chat_identifier/handle`，支持 `mediaUrl` 拉取并落盘再发送。
- 文档定位：`docs/channels/imessage.md`
  - 明确写了 “Status: external CLI integration. Gateway spawns `imsg rpc`”。

### msgcode（本仓库）

- 入口：`src/index.ts`
  - 创建 `IMessageSDK`，启动 listener。
- 监听与收发：`src/listener.ts`
  - `sdk.startWatching(...)` + `sdk.getMessages({ unreadOnly: true })` 补漏。
  - 群发：`osascript` 发到 `chat id`（并读 DB 验证回执/重发）。
  - 已读：`sqlite3` 直接写 `chat.db`，并声明 AppleScript 标已读不可靠。
- 文件监听：`src/watcher.ts`
  - `fs.watch(chat.db)` 触发后仍然走 `sdk.getMessages({ unreadOnly: true })` 拉取。
- 文档定位：`README.md`
  - 明确写了 “关闭 iCloud 消息同步”（因为依赖 DB 写与未读状态）。

## 实现手段对比（核心机制）

| 维度 | Moltbot | msgcode |
|---|---|---|
| 收消息触发源 | `imsg rpc` 推送（`watch.subscribe`） | SDK watcher + 未读轮询；可选 `fs.watch(chat.db)` 触发轮询 |
| 新消息判定 | 事件流 + 自己的去抖/权限/路由/历史 | `unreadOnly` + 自己的去重集合 + 标记已读驱动 |
| 发送能力 | RPC `send`：DM/群聊统一；支持 chat_id/chat_guid/handle | 私聊：SDK `send`（失败降级 AppleScript）；群聊：AppleScript（SDK 不支持群发） |
| 附件 | 可选纳入；本地路径 + 远端 host 用 SCP 拉取再喂给模型 | 主要围绕文字与 tmux；附件走 tmux sender（与 iMessage 侧能力解耦） |
| 权限依赖 | Full Disk Access + Automation（发送时） | Full Disk Access + Automation + `sqlite3` 写 DB 的稳定性；并要求关闭 iCloud 同步 |
| 多账号/远端 | 多账号配置；`cliPath` 可指向 SSH wrapper；远端附件 SCP | 主要单机单账号；未见远端/多账号抽象 |
| 复杂度来源 | 把复杂度“外包”给 `imsg`，自身做状态机与安全/路由 | 多机制拼接（SDK+AppleScript+sqlite+watch+poll）导致状态与故障面扩大 |

## 拆解：为什么两者的“复杂度曲线”不同

### 1) 输入链路（发现新消息）

**Moltbot**（更像“消息总线”）：

```
imsg rpc (push) ──► JSON-RPC notification(method=message)
                 └─► debounce/allowlist/mention gating/history/session/dispatch
```

优势：
- 不依赖“已读状态”，不需要写 chat.db。
- 事件驱动：少轮询、少重复、少“自愈逻辑”。

**msgcode**（更像“在未读上做触发器”）：

```
fs.watch(chat.db) ─► sdk.getMessages(unreadOnly) ┐
sdk.startWatching ─► onNewMessage/onGroupMessage ├─► 去重/队列/路由/tmux
2s polling        ─► sdk.getMessages(unreadOnly) ┘
                     └─► 为了不重复：写 chat.db 标已读
```

后果：
- 你引入了 3 个触发源（watcher / poll / fs.watch），必须写大量去重/心跳/自愈代码兜底（listener.ts 里已经出现了这个趋势）。
- `unreadOnly` 让“系统正确性”绑定在 read 标记上：一旦写失败/被 iCloud 回滚/被多设备改写，就会出现漏收/重复/卡死等不可控症状。

### 2) 输出链路（发送与确认）

**Moltbot**：
- 统一走 RPC `send`（`src/imessage/send.ts`），天然支持群聊/DM 的同构目标（chat_id/chat_guid/handle）。
- 发送/分片/表格转换/媒体下载全部在同一层封装，故障面可控。

**msgcode**：
- 群聊发送走 AppleScript，因为 SDK 不支持群发（`listener.ts` 里的 `sendToChatGroup`）。
- 为了“确认群聊是否发出去”，又额外引入了读 chat.db 的回执校验与重发逻辑。
- 私聊发送走 SDK，失败再降级 AppleScript；于是“发送”也变成了多分支状态机。

核心洞察：
- **当发送与确认都离不开 AppleScript + DB 读写时，你的可靠性上限被系统 UI/权限/同步机制锁死。**

## msgcode 的改进空间（按优先级）

### P0（立刻做，降系统性风险；改动可控）

1) **切断对“写已读”的依赖**
   - 把“是否已处理”从 Messages 的 read 状态，迁移到 msgcode 自己的本地状态（例如：每个 chatId 记录 lastSeenMessageId / lastSeenDate / lastSeenRowId）。
   - 接收侧改成：拉取最近 N 条（不必 unreadOnly）→ 过滤 `date`/`rowId` 大于 lastSeen → 处理后更新 lastSeen。
   - 结果：不写 chat.db → README 里“必须关闭 iCloud 同步”的硬约束有机会移除（或至少降级为“建议”）。

2) **把触发源收敛为 1 个主链路 + 1 个保底链路**
   - 保留：`sdk.startWatching`（主） + 低频 polling（保底）。
   - `fs.watch(chat.db)` 可以先下线（或仅用于“触发一次 check”，但不要再叠加未读逻辑）。
   - 结果：大量去重/心跳/自愈分支可以自然消失，listener.ts 复杂度会显著下降。

3) **统一“群聊/私聊发送”接口**
   - 在 msgcode 内部抽象 `sendMessage({ target, text, attachments? })`，把 AppleScript/SDK 的分支封装在一处。
   - 结果：发送侧的重试、超时、截断、日志字段可以一致化（当前分散在多函数中）。

### P1（中期做，提升稳定性与可维护性）

1) **引入 `imsg rpc` 作为群聊发送的替代**
   - Moltbot 已验证：RPC `send` 支持 chat_id/chat_guid/chat_identifier（见 `src/imessage/send.ts`）。
   - msgcode 可以：保留 imessage-kit 用于收消息，但把“群发 AppleScript”替换为“RPC send”。
   - 直接收益：显著减少 AppleScript 抖动与权限弹窗对可靠性的影响；也可减少“群发回执校验 + 重发”的复杂度。

2) **把“消息目标”做成可解析的类型（去掉字符串约定）**
   - 参考 Moltbot：`src/imessage/targets.ts`（chat_id/chat_guid/handle/service 的解析与 normalize）。
   - msgcode 目前对 `any;+;GUID`、纯 GUID、`any;-;email` 混用，导致发送/校验/路由到处做字符串分支。

3) **把“权限/依赖检查”变成一次性 probe + 明确错误码**
   - Moltbot 有 `probeIMessage`（`src/imessage/probe.ts`），先验证 binary 存在与 RPC 可用。
   - msgcode 可做同样的 `probe`：SDK 能否读 DB、AppleScript 能否发送、sqlite3 是否可用；输出机器可解析的状态，方便外部守护/launchd 做自愈。

### P2（长期：让架构更像产品，而不是脚本集合）

1) **把收/发完全迁移到 `imsg rpc`，把 imessage-kit 作为 fallback**
   - 最终目标：事件流（watch.subscribe）+ 统一 send + 不写 chat.db。
   - msgcode 只关注“路由到 tmux / 解析输出 / 交互状态机”，iMessage I/O 变成纯 provider。

2) **引入“会话存储”（每群一个状态机）**
   - 现在 msgcode 的很多“防重/排队/超时”是全局 Map；建议落到每个 chatId 的小状态机对象，降低共享可变状态的复杂度。

## 推荐迁移路线（两条可选，按风险/收益）

### 方案 A（低风险）：不引入新外部依赖，先消掉 DB 写与多触发源

- Step 1：lastSeen 状态替代 markAsRead（停止写 chat.db）
- Step 2：收敛 watcher：SDK watcher + 低频 poll
- Step 3：统一发送接口（仍保留 AppleScript 群发）

适用：你要快速“去系统性不稳定”，但暂时不想引入 `imsg`。

### 方案 B（高收益）：引入 `imsg rpc`，优先替换“群聊发送 + 事件推送”

- Step 1：引入 `imsg rpc send` 替换群聊 AppleScript
- Step 2：引入 `watch.subscribe` 替换/旁路 `unreadOnly` 拉取
- Step 3：逐步下线 sqlite3/AppleScript 的主路径，仅保留 fallback

适用：你要把 msgcode 做成长期稳定可运维的“本地 iMessage Bot 平台”。

## 验证清单（做完改动后怎么证明更好）

- 可靠性
  - 连续运行 24h：无 watcher 停摆/重复消息风暴/群发失败重发循环。
  - iCloud 同步开启/多设备同时在线：不漏收、不重复（或重复可控且可去重）。
- 权限
  - 仅授予 Full Disk Access + Automation：能收/能发/无额外 sqlite3 写入失败导致的功能性退化。
- 复杂度
  - listener.ts 的“全局去重/自愈 Map 数量”下降；触发源减少；分支数减少。
