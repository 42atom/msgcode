# SCHEDULE.md Protocol Definition

## Purpose

Define the alarm/cron schedule protocol for workspace wake-up, including:
- Schedule file structure
- Mapping to wake job / wake record
- Missed wake catch-up rules

---

## 1. Schedule File Structure

**File location**: `<workspace>/.msgcode/schedules/<scheduleId>.json`

> Note: This is separate from `<workspace>/.msgcode/wakeups/jobs/*.json`.
> - `schedules/*.json` = alarm/cron "when to wake"
> - `wakeups/jobs/*.json` = wake job "what to wake for"

### Schedule File Schema (v2)

```json
{
  "version": 2,
  "enabled": true,
  "schedule": {
    "kind": "at" | "every" | "cron",
    "atMs": 1234567890000,
    "everyMs": 3600000,
    "anchorMs": 0,
    "expr": "0 9 * * *",
    "tz": "Asia/Shanghai"
  },
  "wake": {
    "mode": "now" | "next-heartbeat",
    "taskId": "optional-task-id",
    "hint": "optional reminder text",
    "latePolicy": "run-if-missed" | "skip-if-missed"
  },
  "createdAt": 1234567890000,
  "updatedAt": 1234567890000
}
```

### Field Definitions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| version | number | Yes | Schema version, must be 2 |
| enabled | boolean | Yes | Whether this schedule is active |
| schedule | object | Yes | Time specification |
| schedule.kind | "at" \| "every" \| "cron" | Yes | Schedule type |
| schedule.atMs | number | If kind="at" | Exact timestamp in ms |
| schedule.everyMs | number | If kind="every" | Interval in ms |
| schedule.anchorMs | number | If kind="every" | Anchor timestamp for interval calculation |
| schedule.expr | string | If kind="cron" | Cron expression |
| schedule.tz | string | If kind="cron" | Timezone (IANA format) |
| wake | object | Yes | Wake configuration |
| wake.mode | "now" \| "next-heartbeat" | Yes | Wake mode |
| wake.taskId | string | No | Associated task ID (optional for light path) |
| wake.hint | string | No | Reminder text |
| wake.latePolicy | "run-if-missed" \| "skip-if-missed" | Yes | Policy when wake is missed |
| createdAt | number | Yes | Creation timestamp (ms) |
| updatedAt | number | Yes | Last update timestamp (ms) |

---

## 2. Schedule vs Wake Job vs Wake Record

### Relationship

```
Schedule (alarm when) --> Wake Job (plan) --> Wake Record (triggered fact)
        schedules/*.json      wakeups/jobs/*.json    wakeups/records/*.json
```

###分工

| Layer | Responsibility | Ownership |
|-------|----------------|-----------|
| Schedule | "When to wake" - time semantics | User-facing cron/alarm |
| Wake Job | "What wake to create" - plan | Runtime generated from schedule |
| Wake Record | "This wake is due" - fact | Runtime created when schedule triggers |

### Mapping Rules

1. **Schedule -> Wake Job**: When schedule is created/updated, runtime creates/updates a Wake Job
2. **Wake Job -> Wake Record**: When Wake Job time is reached, runtime creates a Wake Record
3. **Wake Record -> Consume**: Wake Record is consumed by heartbeat tick

The chain is fixed:
```
Schedule (when to wake)
  |
  v
Wake Job (what to wake for - plan)
  |
  v
Wake Record (this wake is due - fact)
  |
  v
Heartbeat consume
```

> **Note**: See `src/runtime/wake-types.ts` for Wake Record status definitions. Expired status uses `completedAt` field (not a separate `expiredAt` field).

---

## 3. Missed Wake Catch-Up Rules

### Detection

A wake is "missed" when:
- `scheduledAt < now` AND
- Wake Record status is still `pending` OR
- Wake Record was never created

### Catch-Up Flow

```
Startup / Heartbeat Tick
  |
  v
Scan all Wake Records
  |
  v
Filter: status=pending AND scheduledAt < now
  |
  v
For each missed wake:
  |
  +-- latePolicy = "run-if-missed"
  |    |
  |    +--> Add to pending consume queue
  |         (normal consume flow)
  |
  +-- latePolicy = "skip-if-missed"
       |
       +--> Mark status = "expired"
            +--> Set completedAt = now  (expired uses completedAt field)
            +--> (Optional) Generate notification
```

### Catch-Up Timing

- **Startup**: Scan and catch-up immediately
- **Heartbeat Tick**: Scan and catch-up as part of normal tick
- **Schedule Trigger**: Create Wake Record at exact time (not deferred)

### Cascade Update Boundary

`Schedule` 只表达未来何时唤醒。

一旦某次触发已经生成了 `Wake Record`，该 record 的生命周期就独立于 `schedules/*.json`。

最小规则：

- 修改或删除 `schedules/*.json` 只影响未来的 wake 计划
- 已生成的 `wakeups/jobs/*.json` 与 `wakeups/records/*.json` 不因 schedule 删除而自动失效
- 除非显式 cancel / GC 动作，否则未执行 record 继续按既有合同生效

### Late Policy Semantics

| Policy | Behavior when missed |
|--------|---------------------|
| `run-if-missed` | Execute anyway when caught |
| `skip-if-missed` | Mark as expired, skip execution |

---

## 4. Schedule Trigger Implementation

### Trigger Flow

```
Scheduler detects schedule time reached
  |
  v
Check if Wake Record already exists (idempotent)
  |
  +-- Exists: Skip (prevent duplicates)
  |
  +-- Doesn't exist:
       |
       v
       Create Wake Record:
       - id: <scheduleId>-<timestamp>
       - jobId: <scheduleId>
       - status: pending
       - scheduledAt: <schedule_time>
       - path: task (or run for light path)
       - latePolicy: from schedule.wake.latePolicy
       - hint: from schedule.wake.hint
       - taskId: from schedule.wake.taskId (optional)
```

### Idempotency

- Schedule trigger must be idempotent
- Same schedule + same time = same Wake Record ID
- Check existence before creation

### Deterministic ID Rule

Wake Record ID 不能包含随机因子。

建议最小口径：

- `recordId = hash(workspacePath + scheduleId + scheduledAt)`

硬约束：

- 同一 workspace 下，同一 schedule、同一触发时刻，必须得到同一个 record ID
- 崩溃恢复后重复扫描，也不能在同一点生成两个物理 record 文件

### `wake.mode` Physical Semantics

`wake.mode` 只决定“如何把唤醒信号送进主循环”，不绕过 heartbeat 的主执行边界。

- `next-heartbeat`
  - 正常落到下一轮 heartbeat 消费
- `now`
  - 只尝试一次 workspace 级 `triggerNow()` 信号投递
  - 若 runner 正忙、命中防重入或无法立即接手，自动降级到 `next-heartbeat`

一句话：

- `now` 是加速提示，不是绕过主链的直通车

---

## 5. Template

### Basic Schedule Template

```json
{
  "version": 2,
  "enabled": true,
  "schedule": {
    "kind": "cron",
    "expr": "0 9 * * *",
    "tz": "Asia/Shanghai"
  },
  "wake": {
    "mode": "next-heartbeat",
    "hint": "Morning check-in",
    "latePolicy": "run-if-missed"
  },
  "createdAt": 1234567890000,
  "updatedAt": 1234567890000
}
```

### One-Time Schedule Template

```json
{
  "version": 2,
  "enabled": true,
  "schedule": {
    "kind": "at",
    "atMs": 1700000000000
  },
  "wake": {
    "mode": "now",
    "taskId": "tk-example-123",
    "hint": "Review task progress",
    "latePolicy": "skip-if-missed"
  },
  "createdAt": 1234567890000,
  "updatedAt": 1234567890000
}
```

---

## 6. Not Covered in This Spec

- Schedule editing/deletion workflow (CLI concern)
- Schedule conflict resolution (multiple schedules at same time)
- Schedule notification on expiration
- Integration with external calendar systems

---

## 7. References

- Plan: `docs/plan/pl0204.pss.runtime.heartbeat-alarm-and-reflection-mainline.md`
- Wake: `docs/plan/pl0210.pss.runtime.wake-record-and-work-capsule-mainline.md`
- Wake Types: `src/runtime/wake-types.ts`
- HEARTBEAT Protocol: `docs/protocol/HEARTBEAT.md`
- REFLECTION Protocol: `docs/protocol/REFLECTION.md`
