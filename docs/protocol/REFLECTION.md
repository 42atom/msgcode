# REFLECTION.md Protocol Definition

## Purpose

Define the reflection review protocol for workspace, including:
- Daily report structure
- Memory candidate naming and location
- Skill candidate naming and location
- Reflection review checklist for heartbeat

---

## 1. Reflection Trigger Moments

Reflection happens at two fixed moments:

1. **Task Complete**: When a parent/subtask reaches `completed` status
2. **Daily Heartbeat**: When daily heartbeat runs (e.g., 18:00)

---

## 2. Daily Report Structure

**File location**: `<workspace>/AIDOCS/reports/daily/<YYYY-MM-DD>.md`

### Template

```markdown
# Daily Report - YYYY-MM-DD

## Summary
- 今日完成的主要任务
- 遇到的主要问题

## Tasks
| Task ID | Status | Notes |
|---------|--------|-------|
| tk-xxx  | done   | 备注  |

## Reflection Candidates

### Memory Candidates
- [ ] memory_pattern_20260315: 什么经验值得记住

### Skill Candidates
- [ ] skill_cli_20260315: 什么操作可以固化成 skill

## Tomorrow
- 明天计划
```

### Field Definitions

| Field | Required | Description |
|-------|----------|-------------|
| Summary | Yes | Brief summary of the day |
| Tasks | No | List of tasks worked on |
| Reflection Candidates | No | Candidates for review |
| Tomorrow | No | Plans for next day |

---

## 3. Memory Candidate

### Naming Convention

```
memory_<category>_<timestamp>
```

Examples:
- `memory_pattern_20260315`
- `memory_error_20260315`
- `memory_workflow_20260315`

Categories:
- `pattern`: Recurring pattern discovered
- `error`: Error handling insight
- `workflow`: Workflow improvement
- `tool`: Tool usage insight
- `general`: General learning

### Location

**Primary**: Inside daily report (under ## Reflection Candidates)
**Staging**: `<workspace>/.msgcode/reflection/memory-candidates/<candidate-id>.md`

### Candidate Structure

```markdown
---
status: pending
createdAt: 1700000000000
updatedAt: 1700000000000
---

# Memory Candidate: memory_pattern_20260315

## Type
pattern

## Content
发现了什么模式/经验

## Context
- 任务: tk-xxx
- 场景: 什么场景下发现

## Evidence
支撑这个发现的证据

## Suggested Action
- merge: 合并到现有 memory
- keep: 保留待后续审核
- discard: 可以丢弃
```

> **Status Field**: Must be in front matter. Values: `pending` | `approved` | `merged` | `rejected`

### Status

| Status | Meaning |
|--------|---------|
| pending | Awaiting review |
| approved | Approved for merge |
| merged | Successfully merged |
| rejected | Rejected |

---

## 4. Skill Candidate

### Naming Convention

```
skill_<category>_<timestamp>
```

Examples:
- `skill_cli_20260315`
- `skill_debug_20260315`
- `skill_workflow_20260315`

Categories:
- `cli`: Command line improvement
- `debug`: Debugging workflow
- `workflow`: Process automation
- `prompt`: Prompt engineering
- `general`: General skill

### Location

**Primary**: Inside daily report (under ## Reflection Candidates)
**Staging**: `<workspace>/.msgcode/reflection/skill-candidates/<candidate-id>.md`

### Candidate Structure

```markdown
---
status: pending
createdAt: 1700000000000
updatedAt: 1700000000000
---

# Skill Candidate: skill_cli_20260315

## Category
cli

## Skill Summary
一句话描述这个 skill

## Trigger
When should this skill be used?

## Steps
1. Step one
2. Step two

## Evidence
Evidence that this skill works

## Suggested Action
- create_skill: 创建正式 skill 单
- keep: 保留待后续审核
- discard: 可以丢弃
```

> **Status Field**: Must be in front matter. Values: `pending` | `approved` | `created` | `rejected`

### Status

| Status | Meaning |
|--------|---------|
| pending | Awaiting review |
| approved | Approved for creation |
| created | Skill created from candidate |
| rejected | Rejected |

---

## 5. Reflection Review Checklist

When heartbeat runs, it should check for pending candidates:

### Checklist

```
1. Scan .msgcode/reflection/memory-candidates/*.md
   - Filter: status = pending

2. Scan .msgcode/reflection/skill-candidates/*.md
   - Filter: status = pending

3. For each pending candidate:
   a. Review content
   b. Decide: approve / reject / keep_pending
   c. Update status

4. If approved:
   - memory: Queue for memory merge (manual or future system)
   - skill: Create task for skill creation

5. If rejected:
   - Move to .msgcode/reflection/archived/

6. If keep_pending:
   - Leave for next review cycle
```

### Review Criteria

| Question | Decision Guide |
|----------|----------------|
| Is this reusable? | If yes, approve |
| Is this specific to one task? | If yes, likely discard |
| Is there evidence? | Without evidence, keep pending |
| Is this a pattern? | If pattern, approve as memory |
| Is this a repeatable action? | If repeatable, approve as skill |

---

## 6. Candidate Not Auto-Upgrade

### Hard Rule

> **Candidate is NOT automatically upgraded to formal memory/skill.**

Rules:
1. Candidate must be reviewed by heartbeat
2. Only explicit approval triggers upgrade
3. No automatic merging without review

### Upgrade Workflow

```
Candidate Created
     |
     v
Heartbeat Review
     |
     +-- approve --> Update status to "approved"
     |                   |
     |                   v
     |               Queue for action
     |
     +-- reject --> Update status to "rejected"
     |                   |
     |                   v
     |               Move to archive
     |
     +-- keep_pending --> Leave as pending
                               |
                               v
                         Next heartbeat
```

---

## 7. Integration with HEARTBEAT.md

### HEARTBEAT.md Updates

After reflection review, heartbeat can update HEARTBEAT.md:

```markdown
## Pending Review
- memory_pattern_20260315 (approved - merge pending)
- skill_cli_20260315 (pending)
```

### Priority Rules

1. Heartbeat checks pending candidates first
2. After review, proceeds to normal wake/task scan
3. If no pending candidates and no wake/tasks, output HEARTBEAT_OK

---

## 8. Directory Structure

```
<workspace>/
  AIDOCS/
    reports/
      daily/
        YYYY-MM-DD.md      # Daily reports
  .msgcode/
    reflection/
      memory-candidates/
        memory_*.md        # Memory candidates
      skill-candidates/
        skill_*.md         # Skill candidates
      archived/
        memory_*.md         # Rejected memory
        skill_*.md          # Rejected skill
```

---

## 9. Not Covered in This Spec

- Memory merge implementation (future task)
- SKILL.md creation automation (future task)
- Vitals integration
- Task dispatch workflow

---

## 10. References

- Plan: `docs/plan/pl0204.tdo.runtime.heartbeat-alarm-and-reflection-mainline.md`
- HEARTBEAT Protocol: `docs/protocol/HEARTBEAT.md`
- SCHEDULE Protocol: `docs/protocol/SCHEDULE.md`
