# DISPATCH.md Protocol Definition

## Purpose

Define the doc-first dispatch protocol for workspace, including:
- Parent/child task relationship
- Dispatch record structure
- Boundaries with issues/*.md and .msgcode/dispatch/*.json

---

## 1. Task Relationship

### Parent Task

- **Location**: `issues/tkNNNN.<state>.<board>.<slug>[.prio].md`
- **Purpose**: User-facing goal, represents what user wants
- **Reviewer**: Default `user`
- **Status**: Controlled by filename (tdo/doi/rvw/pss/dne/cand)

### Child Task

- **Location**: `issues/tkNNNN.<state>.<board>.<slug>[.prio].md`
- **Purpose**: Executable dispatch card, represents a single unit of work
- **Assignee**: `codex`, `claude-code`, `local`, etc.
- **Reviewer**: Default `agent`
- **Status**: Controlled by filename (tdo/doi/rvw/pss/dne/cand/bkd)

### Relationship Rules

1. Child task must reference parent task in front matter `links`
2. Parent task front matter contains child task IDs in `implicit.waiting_for`
3. Parent task state advances only when critical child tasks pass
4. Child task state advances first, parent state advances after

---

## 2. Dispatch Record

**File location**: `<workspace>/.msgcode/dispatch/<dispatchId>.json`

### Structure

```json
{
  "dispatchId": "dispatch-xxx",
  "parentTaskId": "tk0001",
  "childTaskId": "tk0002",
  "client": "codex",
  "persona": "frontend-builder",
  "subagentTaskId": "subagent-xxx",
  "goal": "Implement login page",
  "cwd": "/workspace/path",
  "constraints": ["no-backend-change"],
  "acceptance": ["page-runs", "form-validates"],
  "expectedArtifacts": ["/path/to/output"],
  "status": "pending",
  "result": {
    "completed": true,
    "artifacts": ["/path/to/output"],
    "evidence": ["/path/to/screenshot.png"],
    "summary": "Login page implemented"
  },
  "createdAt": "2026-03-16T10:00:00Z",
  "updatedAt": "2026-03-16T10:30:00Z"
}
```

### Field Definitions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| dispatchId | string | Yes | Unique dispatch ID |
| parentTaskId | string | Yes | Parent task ID |
| childTaskId | string | Yes | Child task ID |
| client | string | Yes | Execution client (codex/claude-code/local) |
| persona | string | No | Persona to use |
| subagentTaskId | string | No | Subagent task ID (after start) |
| goal | string | Yes | Dispatch goal |
| cwd | string | Yes | Working directory |
| constraints | string[] | No | Execution constraints |
| acceptance | string[] | Yes | Acceptance criteria |
| expectedArtifacts | string[] | No | Expected output paths |
| status | string | Yes | pending/running/completed/failed |
| result | object | No | Execution result |
| createdAt | string | Yes | Creation timestamp |
| updatedAt | string | Yes | Last update timestamp |

---

## 3. Boundaries

### Issues vs Dispatch

| Aspect | issues/*.md | .msgcode/dispatch/*.json |
|--------|-------------|--------------------------|
| Status Source | Filename state | JSON status field |
| Primary Purpose | Task truth | Runtime binding |
| Who Reads | User, heartbeat | Runtime, recovery |
| Writes | git mv (manual) | Runtime (automatic) |

### Priority

When there's a conflict:
1. `issues/*.md` filename state is the source of truth
2. `dispatch/*.json` status is runtime cache
3. Recovery reads issues first, dispatch second

---

## 4. Dispatch Flow

### Creation

```
User Goal
    |
    v
Create Parent Task (issues/tkXXXX.tdo...)
    |
    v
Create Child Task (issues/tkYYYY.tdo...)
    |
    v
Create Dispatch Record (.msgcode/dispatch/xxx.json)
    |
    v
Start Subagent (if applicable)
```

### Heartbeat Inspection

```
Heartbeat Tick
    |
    v
Read HEARTBEAT.md
    |
    v
Scan dispatch/*.json (status = pending/running)
    |
    v
Check subagent status
    |
    v
If completed: update dispatch, advance child task
    |
    v
If all critical children done: advance parent task
```

### Delivery Writeback

```
Subagent Complete
    |
    v
Write result to dispatch/*.json
    |
    v
Update child task status (filename)
    |
    v
If critical children done: advance parent task
```

---

## 5. Integration with Heartbeat

### Wake -> Dispatch Priority

When wake is consumed:
1. Check if wake has associated dispatch
2. If yes, read dispatch record
3. Resume from dispatch checkpoint

### Normal Dispatch Scan

```
1. Scan .msgcode/dispatch/*.json
2. Filter: status = pending OR (status = running AND timeout)
3. For each pending:
   - Check subagent status
   - If subagent done: process result
4. Report: pending dispatch count, blocked count
```

---

## 6. Template

### Parent Task Template

```markdown
---
owner: user
assignee: agent
reviewer: user
why: 用户目标描述
scope: 任务范围
risk: medium
accept: 用户验收口径
implicit:
  waiting_for: tk0002, tk0003
  next_check: ""
  stale_since: ""
links: []
---

# Goal

一句话用户目标

## User Outcome

- 用户最终得到什么
- 如何确认问题已解决

## Deliverables

- /path/to/output-a
- /path/to/output-b
```

### Child Task Template

```markdown
---
owner: agent
assignee: codex
reviewer: agent
why: 派单原因
scope: 执行范围
risk: low
accept: 子任务验收标准
implicit:
  waiting_for: ""
  next_check: ""
  stale_since: ""
links:
  - issues/tk0001.tdo.board.goal.p0.md
---

# Dispatch Card

## Parent

- tk0001

## Assignee

- client: codex
- persona: frontend-builder

## Goal

一句话执行目标

## CWD

- /workspace/path

## Constraints

- 不改服务端
- 只在指定目录

## Acceptance

- 验收项 1
- 验收项 2
```

---

## 7. Not Covered in This Spec

- Persona loading/selection
- Multi-level parent-child (grandparent)
- Parallel dispatch coordination
- Dispatch history/audit trail

---

## 8. References

- Plan: `docs/plan/pl0202.pss.agent.persona-and-doc-dispatch-mainline.md`
- Template: `docs/plan/rs0202.dne.agent.persona-and-dispatch-templates.md`
- Work Continuity: `src/runtime/work-continuity.ts`
- Subagent: `src/runtime/subagent.ts`
