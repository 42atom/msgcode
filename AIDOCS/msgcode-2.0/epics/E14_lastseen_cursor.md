# E14: 收消息游标（去 DB 写）

## Goal
实现基于 `lastSeen` 游标的收消息机制，消除对 `chat.db` 的写依赖，实现"重启不补历史、不重复、不写 chat.db"。

## Background

### 现状问题
- **msgcode 1.x** 依赖 `markAsRead`/`chat.db` 写入来驱动 unread 流水线
- **重启后补发历史消息**：无法区分"新消息"和"历史积压"
- **DB 写权限问题**：需要 `~/Library/Messages` 写权限， iCloud 同步可能冲突
- **重复消息风险**：SDK Watcher + 轮询可能重复推送同一条消息

### 解决思路
- imsg RPC 的 `watch.subscribe` 支持：
  - `since_rowid`：只推送 `rowid > since_rowid` 的消息
  - `start`：用时间窗避免启动时历史积压
- 用 `state.json` 持久化 `lastSeenRowid`，重启后恢复并订阅新消息

注意：消息 `rowid` 是全局递增的（不按 chat 分段），因此订阅时使用全局最大值即可。

## Scope
- 实现 `state.json` 持久化（记录每个群的 `lastSeenRowid`）
- 启动时使用 `start` 时间窗限制初始消息范围
- 运行时更新 `lastSeenRowid` 游标
- 不再依赖 `markAsRead`（不写 `chat.db`）

## Non-goals
- 不实现复杂的消息去重（依赖 since_rowid 机制）
- 不实现消息重放/回溯（启动后只有新消息）
- 不实现跨设备的游标同步（单机场景）
- 不提供“回放历史”的能力（游标只前进不后退）

## Data Model

### state.json 结构
```json
{
  "version": 1,
  "updatedAt": "2026-01-29T10:00:00.000Z",
  "chats": {
    "any;+;e110497bfed546efadff305352f7aec2": {
      "chatGuid": "any;+;e110497bfed546efadff305352f7aec2",
      "lastSeenRowid": 12345,
      "lastMessageId": "msg-guid-xxx",
      "lastSeenAt": "2026-01-29T10:00:00.000Z",
      "messageCount": 42
    }
  }
}
```

### 字段说明
- `version`: Schema 版本号
- `updatedAt`: 全局更新时间
- `chats`: 各群组游标状态
  - `chatGuid`: 群组唯一标识（主键）
  - `lastSeenRowid`: 最后处理的消息 rowid（核心）
  - `lastMessageId`: 最后处理的消息 GUID
  - `lastSeenAt`: 最后处理时间
  - `messageCount`: 累计处理消息数

## Implementation

### Phase 1: StateStore 模块
- [x] 创建 `src/state/store.ts`
- [x] 实现 `loadState()`, `saveState()`（原子写入：.tmp + rename）
- [x] 实现 `updateLastSeen(chatGuid,rowid,messageId)`（仅递增更新）

### Phase 2: 启动窗口控制
- [x] 启动时读取 `state.json`
- [x] 如果有游标：`watch.subscribe({ since_rowid: max(lastSeenRowid), attachments: true })`
- [x] 如果无游标：`watch.subscribe({ start: now-60s, attachments: true })`

### Phase 3: 游标更新
- [x] 每条消息完成处理/明确忽略后更新游标（避免重启重复推送）
- [x] 错误处理：更新失败不阻塞消息处理

### Phase 4: 移除 DB 写
- [x] 主链路不再写入 `chat.db`

### Phase 5: 游标查询/重置（可选但已实现）
- [x] `/cursor`：查看当前群游标状态（RowID/最后时间/累计计数）
- [x] `/reset-cursor`：删除当前群游标记录（用于“强制从下一条开始”）

## Technical Design

### imsg RPC 订阅参数
```typescript
// 首次启动（无 state.json）：
// 使用时间窗避免“历史积压洪泛”
{ start: "<now-60s ISO>", attachments: true }

// 有游标时：
// 只获取 rowid 更大的新消息（全局递增）
{ since_rowid: maxLastSeenRowid, attachments: true }
```

### 游标更新逻辑
```typescript
// src/state/store.ts
export async function updateLastSeen(
  chatGuid: string,
  rowid: number,
  messageId: string
): Promise<void> {
  const state = loadState();
  if (!state.chats[chatGuid]) {
    state.chats[chatGuid] = {
      chatGuid,
      lastSeenRowid: 0,
      messageCount: 0,
    };
  }

  // 只更新 rowid 增量（避免回退）
  if (rowid > state.chats[chatGuid].lastSeenRowid) {
    state.chats[chatGuid].lastSeenRowid = rowid;
    state.chats[chatGuid].lastMessageId = messageId;
    state.chats[chatGuid].lastSeenAt = new Date().toISOString();
    state.chats[chatGuid].messageCount++;
    state.updatedAt = new Date().toISOString();
    await saveState(state);
  }
}
```

### 备注
`state.json` 目前按 chatGuid 存储（便于排查与统计），订阅时使用全局最大 rowid 作为游标即可。

## Guardrails

### 数据安全
- `state.json` 存储在 `~/.config/msgcode/state.json`
- 原子写入保证（`.tmp` + `mv`）
- 定期备份（可选）

### 异常处理
- 游标更新失败不阻塞消息处理
- `rowid` 回退检测（只接受递增）
- 启动时游标验证（异常时重置）

### 向后兼容
- 无 `state.json` 时使用 `start: now-60s`
- 旧版本迁移逻辑

## Testing

### 单测
- [x] `StateStore` 读写测试（`test/state.store.test.ts`）
- [x] 游标更新逻辑测试（只前进不后退）
- [x] 原子写入测试（`.tmp` + rename）
- [x] 异常处理测试（坏 JSON / 版本不匹配）
- [x] `/cursor`/`/reset-cursor` 命令测试

### 集成测试
- [x] 启动窗口控制（通过日志 + 手测验证）

### 手动验证
- [x] 重启后不补发历史消息
- [x] 新消息正常接收
- [x] 不写入 `chat.db`

## Migration Path

### 从 1.x 迁移
1. 部署新版本（带 `state.json` 支持）
2. 首次启动使用 `start: now-60s`
3. 处理消息后自动建立游标
4. 后续启动使用 `since_rowid`

### 回滚方案
- 删除 `state.json` 即可回退到旧行为

## Acceptance Criteria
- [x] 启动时只获取最近 60 秒消息（无游标时）
- [x] 有游标时只获取新消息（`since_rowid`）
- [x] 不再调用 `markAsRead`，不写 `chat.db`
- [x] 游标持久化，重启后恢复
- [x] 提供游标管理命令

## Related Epics
- E02: iMessage Provider 改造（imsg rpc）
- E08: 控制面（群绑定）
- E15: 可观测性探针
