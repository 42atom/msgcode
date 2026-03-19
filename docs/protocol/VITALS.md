# VITALS.md Protocol Definition

## Purpose

Define the workspace vitals projection layer for msgcode, including:
- Signal definitions and physical fact sources
- Derived window computation
- Backpressure policy gradient
- Global gate for cross-workspace contention
- Failure fallback behavior

---

## 1. Core Principle

### Vitals is a Projection, Not a Truth Source

Like `/proc` in Unix:
- **Read-only view** computed from existing truth sources
- **Derived signals**, not stored state
- **Ephemeral**, recalculated on each heartbeat tick
- **Cannot be manually edited** - any manual changes are overwritten on next computation

### What Vitals is NOT

- NOT a task status system (truth is in `issues/*.md` filenames)
- NOT an emotion database (no subjective scores)
- NOT a control plane (it informs, doesn't decide)
- NOT persistent state (it's computed, not stored)

---

## 2. Signal Definitions

### Primary Signals

| Signal | Meaning | Physical Sources |
|--------|---------|------------------|
| `load` | Work backlog pressure | Overdue tasks, stale reviews, pending dispatches |
| `stall` | Execution friction | Error streaks, resource contention, blocked tasks |
| `risk` | Danger level | High-risk operations, missing verify evidence, destructive actions pending |
| `headroom` | Capacity remaining | Context budget, token headroom, session length |
| `readiness` | Execution preparedness | Tool availability, recovery pointer freshness, verify gaps, resource availability |

### Derived Window

| Window | Meaning | Computation |
|--------|---------|-------------|
| `explore_window` | Opportunity to explore | `load` low AND `stall` low AND `risk` low AND `headroom` sufficient AND candidates exist |

---

## 3. Physical Fact Sources

### load Sources

```typescript
interface LoadSources {
  overdueTasks: number;           // tasks past due date
  staleReviews: number;           // reviews not checked in N days
  pendingDispatches: number;      // dispatch records in pending/running
  blockedTasks: number;           // tasks in blocked state
  staleSinceHours: number[];      // hours since last check per task
}
```

**Computation:**
- Base load = overdue tasks count × weight
- + stale reviews count × weight
- + pending dispatches × weight
- Capped at reasonable max (e.g., 10)

### stall Sources

```typescript
interface StallSources {
  errorStreak: number;            // consecutive errors of same type
  resourceContention: number;     // failed resource claims
  blockedDuration: number;        // hours in blocked state
  retryCount: number;             // total retry attempts
  toolFailures: number;           // recent tool call failures
}
```

**Computation:**
- Error streak contributes exponentially
- Resource contention adds linearly
- Blocked duration adds gradually

### risk Sources

```typescript
interface RiskSources {
  destructiveOpsPending: boolean; // rm -rf, force push, etc.
  verifyGaps: number;             // missing verification evidence
  unconfirmedActions: number;     // actions awaiting confirmation
  highRiskFlags: string[];        // explicit risk markers in tasks
}
```

**Computation:**
- Destructive ops → immediate high risk
- Verify gaps add to risk
- Unconfirmed actions add to risk

### headroom Sources

```typescript
interface HeadroomSources {
  contextBudgetRemaining: number; // tokens / percentage
  sessionTurnCount: number;       // conversation length
  activeSubagents: number;        // parallel execution arms
  pendingArtifacts: number;       // incomplete deliverables
}
```

**Computation:**
- Context budget below threshold → reduced headroom
- Long session → reduced headroom
- Many active subagents → reduced headroom

### readiness Sources

```typescript
interface ReadinessSources {
  toolsAvailable: boolean;        // required tools are accessible
  recoveryPointerFresh: boolean;  // checkpoint recently updated
  verifyGapsBlocking: boolean;    // missing evidence blocks progress
  resourcesReady: boolean;        // required resources claimed
  dispatchReady: boolean;         // dispatch record is actionable
}
```

**Computation:**
- All conditions must be true for high readiness
- Any blocking condition → reduced readiness
- Missing recovery pointer → low readiness

---

## 4. Output Structure

```typescript
interface VitalsOutput {
  signals: {
    load: number;        // 0-10 scale
    stall: number;       // 0-10 scale
    risk: number;        // 0-10 scale
    headroom: number;    // 0-10 scale (10 = maximum capacity)
    readiness: number;   // 0-10 scale
  };
  derived: {
    explore_window: boolean;
  };
  reasons: {
    load: string[];      // physical fact explanations
    stall: string[];
    risk: string[];
    headroom: string[];
    readiness: string[];
  };
  policy: {
    mode: "normal" | "defer" | "degrade" | "shed" | "kill" | "restart";
    auto: boolean;       // automatic or requires confirmation
  };
  computedAt: string;    // ISO timestamp
}
```

### Policy Mode Selection

| Condition | Mode | Phase |
|-----------|------|-------|
| `load` < 5 AND `stall` < 3 AND `risk` < 3 | `normal` | Phase 1 |
| `load` >= 7 OR `stall` >= 5 | `defer` | Phase 1 |
| `risk` >= 7 OR `headroom` < 3 | `degrade` | Phase 1 |
| `stall` >= 8 AND errors unrecoverable | `shed` | Phase 2 |
| `risk` >= 9 AND destructive pending | `kill` | Phase 2 |
| `load` >= 10 AND all recovery failed | `restart` | Phase 2 |

**Phase 1 Constraint:**
- Only `normal`, `defer`, `degrade` are allowed
- `shed`, `kill`, `restart` require explicit Phase 2 enablement

---

## 5. Backpressure Gradient

### Phase 1 (Immediate)

| Mode | Behavior |
|------|----------|
| `normal` | Continue execution, open new tasks, explore |
| `defer` | Pause new tasks, focus on existing, checkpoint |
| `degrade` | Minimal actions only: verify, checkpoint, wrap-up |

### Phase 2 (Future)

| Mode | Behavior | Scope Order |
|------|----------|-------------|
| `shed` | Drop non-essential work | subagent → browser → desktop |
| `kill` | Terminate problematic execution | subagent → browser → desktop → main session |
| `restart` | Full restart | main session → daemon |

**Kill/Restart Scope Priority:**
1. Subagent sessions (most granular)
2. Browser / desktop harness
3. Main session
4. Daemon / whole machine (last resort)

---

## 6. Global Gate

### Purpose

Handle cross-workspace resource contention and wake storms.

### Principles

- **No central scheduler** - gates are minimal coordination points
- **File-based locks** - simple, portable, no database
- **Defer on contention** - claim failure → defer, not task failure

### Gated Resources

| Resource | Gate Path | Behavior |
|----------|-----------|----------|
| `llm-tokens` | `~/.config/msgcode/runtime/gates/llm-tokens.lock` | Rate limit across workspaces |
| `browser` | `~/.config/msgcode/runtime/gates/browser.lock` | Single browser instance |
| `desktop` | `~/.config/msgcode/runtime/gates/desktop.lock` | Single desktop harness |
| `subagent:<client>` | `~/.config/msgcode/runtime/gates/subagent-<client>.lock` | Per-client subagent limit |

### Claim Protocol

```typescript
interface GateClaim {
  resource: string;
  workspacePath: string;
  taskId?: string;
  acquired: boolean;
  reason?: string;
}
```

**On claim failure:**
- Do NOT mark task as failed
- Enter `defer` mode in vitals policy
- Retry on next heartbeat tick

---

## 7. Failure Fallback

### Vitals Computation Failure

When vitals cannot be computed (missing data, errors, etc.):

```typescript
interface FallbackVitals extends VitalsOutput {
  signals: {
    load: 5;      // neutral
    stall: 5;     // elevated caution
    risk: 5;      // elevated caution
    headroom: 5;  // neutral
    readiness: 3; // reduced
  };
  derived: {
    explore_window: false;
  };
  reasons: {
    load: ["vitals computation failed - using fallback"];
    stall: ["vitals computation failed - using fallback"];
    risk: ["vitals computation failed - using fallback"];
    headroom: ["vitals computation failed - using fallback"];
    readiness: ["vitals computation failed - using fallback"];
  };
  policy: {
    mode: "degrade";
    auto: true;
  };
}
```

### Conservative Mode Behavior

When in conservative mode (degrade or fallback):
- **No new tasks** - don't open new work items
- **No new subtasks** - don't dispatch new children
- **Only**: verify, checkpoint, wrap-up, evidence collection
- **Truth continuity preserved** - existing work remains recoverable

---

## 8. Integration with Heartbeat

### Heartbeat Tick Flow

```
Heartbeat Tick
    |
    v
Compute Vitals
    |
    v
Read Policy Mode
    |
    v
Select Strategy:
  - normal: continue execution
  - defer: pause new work, focus existing
  - degrade: minimal actions only
    |
    v
Execute Tick
    |
    v
Report Vitals in Heartbeat Output
```

### Vitals in Heartbeat Output

Heartbeat output includes vitals snapshot:

```typescript
interface HeartbeatOutput {
  // ... existing fields
  vitals?: VitalsOutput;
}
```

This allows:
- Observability into system state
- Debugging of backpressure decisions
- Evidence for why certain actions were deferred

---

## 9. File Storage

### Vitals are NOT Persisted

By design, vitals are computed on-demand:
- No persistent storage
- No historical tracking (use logs instead)
- Each heartbeat recomputes from scratch

### Optional: Vitals Log

For debugging, vitals may be logged:

```
~/.config/msgcode/log/vitals-<workspace>-<timestamp>.json
```

But logs are for observability, not for system decisions.

---

## 10. Naming Conventions

### Unix-Style Short Names

Preferred naming (must use):
- `load`, `stall`, `risk`, `headroom`, `readiness`
- `defer`, `degrade`, `shed`, `kill`, `restart`

Avoid narrative/psychological terms:
- NOT: `stress`, `anxiety`, `mood`, `feeling`, `happiness`
- NOT: `energy`, `motivation`, `confidence`

### Why Unix Style?

- **Objective**: measurable from physical facts
- **Familiar**: operators understand load average
- **Neutral**: no anthropomorphic interpretation
- **Composable**: can be combined without ambiguity

---

## 11. Anti-Patterns

### DO NOT

1. **Store vitals as truth** - they are projections, always recompute
2. **Allow manual override** - manual values are overwritten
3. **Make vitals the task status** - issues/*.md filenames are truth
4. **Use subjective scores** - every value must trace to physical facts
5. **Auto-kill in Phase 1** - only defer/degrade allowed initially
6. **Kill main session first** - always start with subagent, then escalate
7. **Let session continuity depend on vitals** - work continuity is independent

### DO

1. **Recompute on every tick** - vitals are always fresh
2. **Trace every signal to facts** - reasons array explains values
3. **Enter conservative mode on failure** - never blind execution
4. **Use global gate for cross-workspace** - prevent thundering herd
5. **Respect Phase 1 limits** - no auto-kill until Phase 2

---

## 12. Examples

### Example 1: High Load, Low Stall

```json
{
  "signals": {
    "load": 7,
    "stall": 2,
    "risk": 3,
    "headroom": 6,
    "readiness": 8
  },
  "derived": {
    "explore_window": false
  },
  "reasons": {
    "load": ["3 overdue tasks", "2 stale reviews"],
    "stall": ["no blocking issues"],
    "risk": ["1 unconfirmed action pending"],
    "headroom": ["60% context budget remaining"],
    "readiness": ["all tools available", "recovery pointer fresh"]
  },
  "policy": {
    "mode": "defer",
    "auto": true
  },
  "computedAt": "2026-03-16T10:00:00Z"
}
```

**Interpretation:** Busy but healthy. Defer new work, focus on existing.

### Example 2: High Risk, Low Headroom

```json
{
  "signals": {
    "load": 4,
    "stall": 3,
    "risk": 8,
    "headroom": 2,
    "readiness": 4
  },
  "derived": {
    "explore_window": false
  },
  "reasons": {
    "load": ["1 pending dispatch"],
    "stall": ["1 resource contention"],
    "risk": ["destructive operation pending", "2 verify gaps"],
    "headroom": ["15% context budget", "long session"],
    "readiness": ["verify gaps blocking", "recovery pointer stale"]
  },
  "policy": {
    "mode": "degrade",
    "auto": true
  },
  "computedAt": "2026-03-16T10:00:00Z"
}
```

**Interpretation:** Dangerous situation. Minimal actions, verify evidence, checkpoint.

### Example 3: Healthy System

```json
{
  "signals": {
    "load": 2,
    "stall": 1,
    "risk": 1,
    "headroom": 9,
    "readiness": 9
  },
  "derived": {
    "explore_window": true
  },
  "reasons": {
    "load": ["1 pending dispatch"],
    "stall": ["no blocking issues"],
    "risk": ["no dangerous operations"],
    "headroom": ["85% context budget"],
    "readiness": ["all systems ready"]
  },
  "policy": {
    "mode": "normal",
    "auto": true
  },
  "computedAt": "2026-03-16T10:00:00Z"
}
```

**Interpretation:** Healthy system. Continue execution, explore window open.

---

## 13. References

- Plan: `docs/plan/pl0205.pss.runtime.work-vitals-and-session-continuity-stack.md`
- BDD: `docs/plan/pl0206.pss.runtime.work-vitals-session-bdd-design.md`
- Issue: `issues/tk0206.pss.runtime.p1.vitals-self-protection-projection-mainline.md`
- Runtime: `src/runtime/heartbeat.ts`
- Heartbeat Protocol: `docs/protocol/HEARTBEAT.md`
- Schedule Protocol: `docs/protocol/SCHEDULE.md`
