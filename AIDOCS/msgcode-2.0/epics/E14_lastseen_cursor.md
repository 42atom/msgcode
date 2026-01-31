# E14 - lastSeenRowId（收消息游标，去 DB 写）

## 背景
msgcode 2.0 已经把收/发收口到 `imsg rpc`，但“重启后如何不补历史、不重复处理、不依赖 markAsRead / chat.db 写入”仍缺一个**单一真相源**：消息游标。

## 目标
- 重启后不需要写 `chat.db` 标已读，也能做到“只处理新消息”。
- 避免 `watch.subscribe` 启动时把历史积压一次性推给 tmux。
- 让重复推送/乱序对系统影响最小（幂等 + 游标前进）。

## 非目标
- 不做回补历史（不支持“从某天开始重新拉取”）。
- 不做 per-chat 的复杂状态机（先做全局游标，足够实用）。

## 设计（推荐：全局游标）
### 单一真相源
- 新增一个全局状态文件：`~/.config/msgcode/state.json`
- 字段：
  - `version: 1`
  - `imsg: { lastSeenRowId?: number, updatedAt: string }`

### 游标推进规则
- 每处理完一条消息（并且通过白名单校验、完成命令处理/转发逻辑）：
  - 解析 `message.id`（imsg message rowid）为 number
  - `lastSeenRowId = max(lastSeenRowId, messageRowId)`
  - 原子写入 `state.json`（临时文件 + rename）

### 订阅规则
- 启动时：
  - 若 `lastSeenRowId` 存在：`watch.subscribe({ since_rowid: lastSeenRowId, attachments: true })`
  - 若不存在：使用时间窗避免历史积压：
    - `watch.subscribe({ start: nowMinus15sISO, attachments: true })`

## 实现任务（给 Opus）
1) 新增模块：`src/state/store.ts`
   - `loadState()` / `saveState()`（原子写）
   - `getImsgLastSeenRowId()` / `setImsgLastSeenRowId(rowid)`
2) 改造订阅：`src/imsg/rpc-client.ts`
   - `subscribe(options?: { sinceRowId?: number; start?: string })`
3) 接入启动：`src/index.ts`、`src/commands.ts`
   - 启动时读取 state，决定 subscribe 参数
4) 接入推进：`src/listener.ts`
   - 在“实际处理完成”后推进游标（不要在白名单拒绝/空消息时推进）
5) 测试
   - 新增：`test/state.store.test.ts`（原子写、版本校验、lastSeen 前进）
   - 新增：`test/imsg.subscribe.test.ts`（subscribe 参数选择逻辑，可通过 mock/spy 验证 request 载荷）

## 验收标准
- 冷启动（无 `state.json`）不会爆发式补历史：只会收到启动后 15s 内的新消息。
- 热重启（有 `lastSeenRowId`）不会重复处理同一条消息（至少“不会重复转发到 tmux”）。
- 全程不写 `chat.db`，不依赖 `markAsRead`。
- `npm test` 全绿，`tsc --noEmit` 通过。

