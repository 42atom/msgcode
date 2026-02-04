# Control Lane Spec（v2.2 / P0）

> 目的：手机端远程控盘时，**只读命令秒回**，同时不打断正在运行的长任务（Codex/Claude），并且不破坏游标安全。

---

## 1) 背景

当前已具备：
- per-chat 串行队列（`perChatQueue`）保证游标安全与输出不乱序
- 中断命令收口：只允许 `/esc /stop /clear` 抢占并 abort
- 长任务回执（3s）降低“无反馈焦虑”
- `/status` 快车道已有雏形（fast lane + 入队仅推进游标）

但体验缺口：
- 只读命令（尤其 `/status`）若排队，会在长任务期间“失明”

---

## 2) 目标（P0）

- **秒回**：长任务进行中时，以下只读命令必须 < 1s 回复：
  - `/status`
  - `/where`
  - `/help`
- **不抢占**：只读命令不得 abort 当前任务，不得向 tmux 注入 ESC，不得 kill 会话
- **不重复回复**：同一条只读命令不允许“快车道回一次，排队后再回一次”
- **游标安全**：不允许为了秒回而提前 `updateCursor`，避免重启后丢消息

---

## 3) 非目标（P0 不做）

- 让所有 slash command 都走 control lane
- 对只读命令做并发/锁的复杂改造（P0 用 two-phase 方案即可）

---

## 4) 设计（Two-Phase）

核心原则：
- **Phase 1（Fast Lane）**：立即回复（只读），不推进游标
- **Phase 2（Queue Lane）**：仍然入队，处理时检测“已快回”，若是则**只推进游标不再回复**

### 4.1 命令白名单

```txt
CONTROL_READONLY_COMMANDS:
  ^/(status|where|help)(\s|$)
```

### 4.2 “已快回”去重键

优先：
- `message.id`

fallback：
- `${chatId}:${rowid}`（rowid 必须存在）

TTL：
- 5 分钟（防内存无限增长）

---

## 5) 实现点（给 Opus 的任务单）

### 5.1 Fast Lane（src/commands.ts）

- 在入队前识别 `CONTROL_READONLY_COMMANDS`：
  - 立即执行 `handleControlCommandFast(message)`
  - 成功发送后 `markFastReplied(key)`
  - **仍然入队**（用于 cursor advancement）
- 注意：fast lane 只做“读”，不得触发 abort

Fast handler 行为：
- `/status`：调用现有 handler（会最终调用 `TmuxSession.status()`）
- `/where`：调用现有 route 命令处理（`handleRouteCommand`）或复用同一逻辑
- `/help`：返回帮助文本（已有实现）

### 5.2 Queue Lane 去重（src/listener.ts）

在 `handleMessage()` 最开始（游标过滤/TTL 去重之前）：
- 若 `wasFastReplied(key)` 为 true：
  - `shouldAdvanceCursor = true; return;`
  - **不要发送任何回复**

---

## 6) 验收（P0）

### 6.1 秒回 + 不抢占

1. 触发长任务（Codex/Claude 任意）
2. 立刻发送 `/status`
   - 1s 内回复
   - 长任务不中断，最终仍返回
3. 重复测试 `/where`、`/help`

### 6.2 不重复回复

1. 发送 `/status`
2. 等待队列追上（长任务结束）
3. 不得出现第二条 `/status` 回复（只能快回一次）

### 6.3 游标安全

1. 触发长任务 → 发送 `/status` 秒回
2. 立即重启 msgcode daemon
3. 不应出现“丢消息/跳过消息”的现象（后续消息仍被处理）

---

## 7) 失败模式与提示

- 无 route 绑定时：
  - `/where` 或 `/status` 应提示 `/bind <dir>`（不刷屏，保持简短）

