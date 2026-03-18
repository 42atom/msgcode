# REFLECTION.md Protocol Definition

## Purpose

定义 workspace reflection 的最小文件协议，只回答三件事：

- 日记落哪
- candidate 落哪
- 下一轮 heartbeat 怎么 review

硬规则：

- reflection 先产出文件
- candidate 不自动升级成正式 memory / skill
- append 是真相，summary / index 只是派生层

---

## 1. Trigger Moments

reflection 只在两个固定时机发生：

1. 任务完成时
2. 每日收口 heartbeat 时

不把 reflection 混进每一轮普通执行。

---

## 2. Output Files

最小只产出三类文件：

1. daily log / diary
2. memory candidate
3. skill candidate

### Directory Layout

```text
<workspace>/
  AIDOCS/
    reports/
      daily/
        YYYY-MM-DD.md
  .msgcode/
    reflection/
      memory-candidates/
        memory-*.md
      skill-candidates/
        skill-*.md
      archived/
        *.md
```

一句话：

- diary 放 `AIDOCS`
- candidate 放 `.msgcode/reflection`

---

## 3. Daily Log / Diary

### Location

`<workspace>/AIDOCS/reports/daily/<YYYY-MM-DD>.md`

### Purpose

daily log 是 reflection 的主叙事文件。

它负责：

- 记录当天完成什么
- 记录今天卡在哪
- 记录下一步
- 汇总 candidate 索引

它不负责：

- 充当正式 memory
- 直接改 skill
- 承载任务状态真相

### Template

```markdown
# Daily Log - YYYY-MM-DD

## Summary
- 今天完成了什么
- 今天最大的阻塞是什么

## Completed
- tkxxxx: 一句话结果

## Evidence
- 产物:
- 文档:
- 日志:

## Reflection
- 哪个判断是对的
- 哪个动作该下次避免

## Memory Candidates
- memory-pattern-YYYYMMDD-001

## Skill Candidates
- skill-workflow-YYYYMMDD-001

## Next
- 下一步最该做什么
```

### Rules

- 每天最多一份 daily log
- 可追加，不覆盖旧内容
- candidate 只在这里挂索引，不把正式内容塞进一处大杂烩

---

## 4. Memory Candidate

### Location

`<workspace>/.msgcode/reflection/memory-candidates/<candidate-id>.md`

### Naming

```text
memory-<category>-<YYYYMMDD>-<seq>
```

例子：

- `memory-pattern-20260318-001`
- `memory-error-20260318-001`

### Categories

- `pattern`
- `error`
- `workflow`
- `tool`
- `general`

### Template

```markdown
---
status: pending
createdAt: 1700000000000
updatedAt: 1700000000000
sourceTaskIds: []
sourceDiary: AIDOCS/reports/daily/2026-03-18.md
---

# Memory Candidate: memory-pattern-20260318-001

## Summary
一句话说明这条经验

## Decision
这次学到了什么

## Evidence
- task:
- artifact:
- log:

## Why Reusable
为什么它值得长期记住

## Suggested Action
- approve
- keep-pending
- reject
```

### Status

- `pending`
- `approved`
- `merged`
- `rejected`

---

## 5. Skill Candidate

### Location

`<workspace>/.msgcode/reflection/skill-candidates/<candidate-id>.md`

### Naming

```text
skill-<category>-<YYYYMMDD>-<seq>
```

例子：

- `skill-cli-20260318-001`
- `skill-workflow-20260318-001`

### Categories

- `cli`
- `debug`
- `workflow`
- `prompt`
- `general`

### Template

```markdown
---
status: pending
createdAt: 1700000000000
updatedAt: 1700000000000
sourceTaskIds: []
sourceDiary: AIDOCS/reports/daily/2026-03-18.md
---

# Skill Candidate: skill-workflow-20260318-001

## Summary
一句话说明这个可复用方法

## Trigger
什么时候该用

## Steps
1. 第一步
2. 第二步

## Evidence
- task:
- artifact:
- log:

## Suggested Action
- approve
- keep-pending
- reject
```

### Status

- `pending`
- `approved`
- `created`
- `rejected`

---

## 6. Heartbeat Review

下一轮 heartbeat 的 reflection review 只做极薄 checklist：

1. 扫 `memory-candidates/*.md`
2. 扫 `skill-candidates/*.md`
3. 只看 `status: pending`
4. 做三种决定：
   - `approve`
   - `keep-pending`
   - `reject`

### Review Rules

#### approve

- candidate 有证据
- candidate 不只是一次性碎片
- candidate 有复用价值

结果：

- 更新状态为 `approved`
- 保留文件
- 后续再由独立动作合并到正式 memory / skill

#### keep-pending

- 有价值，但证据还不够
- 或暂时还不值得升格

结果：

- 保持 `pending`
- 等下一轮 heartbeat 再看

#### reject

- 没证据
- 只是一时情绪
- 只对单次任务成立

结果：

- 更新状态为 `rejected`
- 移到 `.msgcode/reflection/archived/`

---

## 7. Hard Boundaries

### Candidate Not Auto-Upgrade

硬规则：

- memory candidate 不是正式 memory
- skill candidate 不是正式 skill
- daily log 不是任务真相源

所以默认不允许：

- 自动写入 `memory/*.md`
- 自动改 `SKILL.md`
- 自动创建一堆新控制面

### Truth Source Boundary

| 文件 | 作用 | 是否真相源 |
|------|------|------------|
| `AIDOCS/reports/daily/*.md` | 叙事与回顾 | reflection 真相 |
| `.msgcode/reflection/memory-candidates/*.md` | 记忆候选 | reflection 真相 |
| `.msgcode/reflection/skill-candidates/*.md` | skill 候选 | reflection 真相 |
| `memory/*.md` | 正式记忆 append | memory 真相 |
| `issues/*.md` | 任务状态 | 任务真相 |

一句话：

- reflection 文件是真相
- 但它们不是任务状态真相，也不是正式 memory 真相

---

## 8. Not Covered

这份协议不覆盖：

- memory merge 具体实现
- skill 创建自动化
- vitals 集成
- 反思内容生成质量

---

## 9. References

- Plan: `docs/plan/pl0204.tdo.runtime.heartbeat-alarm-and-reflection-mainline.md`
- Mainline: `issues/tk0217.rvw.runtime.p1.reflection-candidate-review-and-daily-log-mainline.md`
- Heartbeat: `docs/protocol/HEARTBEAT.md`
- Memory Audit: `issues/tk0208.rvw.memory.p1.memory-file-truth-and-index-layer-demotion-audit.md`
