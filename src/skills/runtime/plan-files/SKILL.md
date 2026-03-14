---
name: plan-files
description: This skill should be used when the task is complex enough to benefit from task-local planning files, but should not introduce a new plan mode, supervisor, or memory layer.
---

# plan-files skill

## 能力

本 skill 是 file-first planning 说明书，不是系统模式开关。

- 复杂任务时，用文件保存任务内计划、阶段、证据和阻塞
- 让模型把“大任务工作记忆”放到磁盘，而不是全塞进上下文
- 明确 `plan`、`memory`、`/task` 的边界
- 优先复用当前仓库已有协议，不发明新的计划平台

## 何时使用

在以下场景读取并使用本 skill：

- 任务明显超过 3 步
- 预计要跨多个文件 / 模块 / 工具
- 需要边做边记录进度、证据、阻塞
- 用户明确要求“做个计划”“结构化推进”“跟踪进度”
- 需要把研究、实现、验证拆成阶段

## 何时不要用

- 简单问答
- 单文件小改动
- 一次工具调用就能完成的动作
- 已经可以直接交付，不需要额外计划文件

默认原则：**能不落盘就不落盘；要落盘时，先用最少文件。**

## 核心边界

### `plan` 不是 `memory`

- `plan`：当前任务的临时工作记忆，任务结束后价值快速下降
- `memory`：跨任务长期保留的信息，如用户偏好、长期约束、固定环境事实

不要把长期偏好、长期规则、稳定背景写进 plan 文件。

### `plan` 不是 `/task`

- `plan-files`：告诉你怎么用文件规划任务
- `/task` 与 `TaskSupervisor`：负责长任务状态、续跑、取消、恢复

不要因为用了 plan 文件，就再发明新的监督器。

### `plan` 不是交付物

- plan 文件用于推进任务
- 最终交付物是否单独落文件，取决于用户是否需要文件产物

## 最小工作流

### 1. 先判断要不要规划

先问自己：

1. 这件事是否已经复杂到需要任务内工作记忆？
2. 不写 plan，我是否很容易丢阶段、遗漏验收、忘记证据？

如果答案都是否，直接做，不要建 plan 文件。

### 2. 默认只建一份 plan 文件

首选只创建一份计划文件，而不是默认三文件。

推荐最小结构：

```markdown
# <任务标题>

## Goal
- 这次任务最终要达成什么

## Non-Goals
- 明确哪些不做，防止扩 scope

## Deliverable
- 最终交付是什么；如果不需要单独文件，也写清楚

## Acceptance Criteria
- 验收标准

## Phases
- [ ] Phase 1: ...
- [ ] Phase 2: ...
- [ ] Phase 3: ...

## Open Questions
- 当前还不确定的点

## Evidence
- 关键日志、命令、文件路径、测试结果

## Status
- 当前阶段 / 下一步
```

### 3. 只有必要时再加 `notes`

当研究结果、日志、比较项太长，会污染上下文时，再单独建 `notes` 文件。

### 4. 只有用户需要文件产物时，再加 deliverable 文件

不要机械地为每个任务都创建单独交付文件。

## 文件选择策略

### A. 当前仓库已经有正式协议

如果当前项目已经有 `issues/`、`docs/plan/` 这类协议，优先遵守仓库协议，不另起炉灶。

例如在 `msgcode` 仓库：

- 任务事实：`issues/tkNNNN.<state>.<board>.<slug>[.prio].md`
- 设计计划：`docs/plan/plNNNN.<state>.<board>.<slug>[.prio].md`

### B. 当前任务只是工作区内的临时复杂任务

优先使用：

- `AIDOCS/tasks/tkNNNN.<state>.<board>.<slug>[.prio].md`
- `AIDOCS/notes/rsNNNN.<state>.<board>.<slug>.md`

保持文件可读、可追踪，不要创建过深目录树。

## 推荐写法

如果只有 `read_file + bash`：

- 用 `read_file` 先看已有协议或已有 plan 文件
- 用 `bash` 创建或更新文件
- 更新时优先做小修改，不要每轮都整文件重写

## 完成判断

plan 文件不负责“监督”，只负责让完成条件清楚。

完成任务时，至少检查：

1. `Deliverable` 是否已经存在或已经直接回复给用户
2. `Acceptance Criteria` 是否满足
3. `Open Questions` 是否已关闭，或已明确告知用户
4. `Evidence` 是否足够支撑结论

复杂长任务如需额外续跑/恢复，再使用现有 `/task`，不要再加 plan 层。

## 常见错误

- ❌ 每个任务都默认创建三文件
- ❌ 把长期偏好写进 plan 文件
- ❌ 把任务进度写进 memory
- ❌ 因为有了 plan 文件，就再发明一个 plan supervisor
- ❌ 不看当前仓库协议，随手新建一套目录
- ❌ plan 里不写验收标准，最后无法判断是否完成

## 一句话原则

**planning 是任务内文件工作记忆，不是新的系统模式。**
