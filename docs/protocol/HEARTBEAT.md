# HEARTBEAT.md Protocol Definition

## Purpose

Define the protocol for workspace heartbeat巡检, including:
- Minimum structure for HEARTBEAT.md
- Fixed reading order
- Silent ack semantics
- Boundary with other truth sources

---

## 1. HEARTBEAT.md Minimum Structure

**File location**: `<workspace>/.msgcode/HEARTBEAT.md`

### Allowed Fields

```markdown
# Heartbeat Draft

## Attention
- 简短提醒点列表

## Checklist
- [ ] 巡检项 1
- [ ] 巡检项 2

## Notes
- 本轮思考草稿

## Pending Review
- 需要下轮审核的 candidate 列表
```

### NOT Allowed Fields

以下字段**禁止**出现在 HEARTBEAT.md 中：
- 任务状态（应查 issues/*.md）
- 派单结果（应查 dispatch/*.json）
- Subagent 详细状态（应查 subagents/*.json）
- Wake 执行结果（应查 wakeups/records/*.json）
- 最终验收结论
- Checkpoint 恢复指针

---

## 2. Fixed Reading Order

Heartbeat 启动时按以下顺序读取：

1. `HEARTBEAT.md` - 本轮巡检提示
2. `wakeups/records/*.json` - 已到期待消费的 wake（优先级最高）
3. `issues/*.md` - 任务状态真相源
4. `dispatch/*.json` - 派单状态
5. `subagents/*.json` - 子代理状态

### Priority Rules

- Wake 有执行动作时，跳过 task 扫描（避免空转）
- Wake 无到期时，扫描 runnable tasks
- 两者都无时，静默结束

---

## 3. Silent Ack Semantics

### When to Output HEARTBEAT_OK

- 无到期 wake
- 无 runnable tasks
- 无阻塞的 subagent
- 无 pending reflection candidates

> **Note**: Reflection candidate review is defined in `docs/protocol/REFLECTION.md`.

### Format

```
HEARTBEAT_OK
```

### When to Output Progress

- 有 wake 被消费
- 有 task 被推进
- 有 subagent 被处理
- 有 reflection candidate 被审核 (approved/rejected)

> **Note**: Reflection review protocol is defined in `docs/protocol/REFLECTION.md`.

---

## 4. Truth Source Boundary

### HEARTBEAT.md 是草稿，其他是硬状态

| 文件 | 承载内容 | 状态类型 |
|------|----------|----------|
| HEARTBEAT.md | 巡检提示、草稿、提醒 | 非硬状态 |
| issues/*.md | 任务身份、状态、验收 | 硬状态真相 |
| wakeups/records/*.json | Wake 触发、执行、结果 | 硬状态真相 |
| dispatch/*.json | 派单执行、进度 | 硬状态真相 |
| subagents/*.json | 子代理状态 | 硬状态真相 |
| .msgcode/STATUS | 只读观测快照 | 派生物（非真相） |

### Conflict Resolution

若 HEARTBEAT.md 与上述硬状态文件冲突，**一律以后者为准**。

硬规则：
```
issues/*.md 文件名状态 = 任务状态真相源
.msgcode/wakeups/*.json = Wake 运行真相源
.msgcode/dispatch/*.json = 派单执行真相源
.msgcode/subagents/*.json = 子代理真相源
.msgcode/STATUS = 只读投影，不承载状态真相
```

### STATUS Snapshot

- heartbeat 每次 tick 结束后会覆盖写 `.msgcode/STATUS`
- 这是观测面，不是协议面
- 用途：
  - `cat .msgcode/STATUS` 一眼看当前 dispatch / wakes / subagents
  - 快速人工排障
  - 让 LLM 先读全局，再按需下钻 JSON 真相源
- 约束：
  - 不从 `STATUS` 回写状态
  - 不以 `STATUS` 作为恢复输入
  - 真相冲突时，一律以 `issues/`、`dispatch/*.json`、`wakeups/*.json`、`subagents/*.json` 为准

---

## 5. Template

### HEARTBEAT.md Template

```markdown
# Heartbeat Draft

## Attention
- 本轮优先关注点

## Checklist
- [ ] 检查未完成任务
- [ ] 检查 wake 到期
- [ ] 检查 subagent 状态

## Pending Review
- memory_candidate_001  (see docs/protocol/REFLECTION.md)
- skill_candidate_002   (see docs/protocol/REFLECTION.md)

## Notes
- 本轮思考草稿区
```

### Usage in Code

```typescript
interface HeartbeatReadResult {
  attention: string[];
  checklist: Array<{ text: string; checked: boolean }>;
  pendingReview: string[];
  notes: string;
}

function readHeartbeatDraft(workspacePath: string): HeartbeatReadResult {
  // 解析 HEARTBEAT.md
  // 只读 allowed fields
  // 忽略禁止字段或记录警告
}
```

---

## 6. Integration with Wake Consume

Heartbeat tick 执行顺序：

```
1. read HEARTBEAT.md (attention + checklist)
2. scan wakeups/records/*.json (pending + scheduledAt <= now)
3. if has wakes:
   - consume wakes (skip task scan)
   - update HEARTBEAT.md notes if needed
4. else:
   - scan issues/*.md for runnable tasks
   - scan dispatch/*.json for pending
   - scan subagents/*.json for blocked
5. if no actions:
   - output HEARTBEAT_OK
```

---

## 7. Not Covered in This Spec

The following are out of scope for HEARTBEAT.md protocol:

- Alarm/cron schedule file protocol (separate doc)
- Reflection candidate upgrade workflow (separate doc)
- Vitals policy integration (separate doc)
- Subagent detailed status format

---

## 8. References

- Plan: `docs/plan/pl0204.pss.runtime.heartbeat-alarm-and-reflection-mainline.md`
- Wake: `docs/plan/pl0210.pss.runtime.wake-record-and-work-capsule-mainline.md`
- Work Continuity: `docs/plan/pl0205.pss.runtime.work-vitals-and-session-continuity-stack.md`
- Schedule Protocol: `docs/protocol/SCHEDULE.md`
- Reflection Protocol: `docs/protocol/REFLECTION.md`
