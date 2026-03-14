# 24小时长期在线智能体与上下文平滑溢出

## Problem

`msgcode` 现在已经有心跳、任务恢复、摘要注入和若干截断点，但这些能力仍是散的：`HeartbeatRunner` 只负责周期唤醒，`TaskSupervisor` 只覆盖显式 `/task`，`summaryContext` 只是一段历史摘要，`tool_result` / `bash` 输出裁剪则是局部止血。用户要的是“24 小时长期在线 + 长任务可持续推进 + 上下文窗口溢出时平滑退化”，而不是更多零散补丁。

## Occam Check

- 不加它，系统具体坏在哪？
  复杂长任务会在普通聊天和显式 `/task` 之间分裂；上下文预算靠多个局部硬截断，模型会突然失忆；任务跨心跳/重启后的续跑策略也不统一。
- 用更少的层能不能解决？
  能。复用现有 `HeartbeatRunner`、`TaskSupervisor`、`summaryContext`、task-local plan 文件与 artifacts，只补统一预算装配与分层溢出，不新建 plan mode 或控制平面。
- 这个改动让主链数量变多了还是变少了？
  变少了。把“长期在线”收口成一条主链：持久化任务状态 + 分层上下文装配 + 心跳续跑。

## Decision

采用“**持久化任务状态 + 分层上下文装配 + 平滑溢出**”的薄方案：

1. **长期任务的唯一 durable substrate 继续是 `/task` / `TaskSupervisor`**
   - 普通消息仍保持轻量聊天
   - 需要跨心跳/重启/多阶段推进的任务，进入显式任务主链
   - `plan-files` 作为 task-local 工作记忆 skill，不新增新的监督器

2. **上下文不追求无上限堆叠，而是分层装配**
   - 固定层：system / soul / workspace hints / 工具索引
   - 任务层：goal、acceptance、current phase、blocked reason、最近 checkpoint
   - 交互层：最近若干轮真实消息
   - 证据层：必要的文件摘录、tool_result 预览、artifact 路径
   - 长尾信息不直接塞窗口，只保留 summary 或路径引用

3. **窗口溢出走分层降级，不走突然裁断**
   - 先裁大 tool outputs
   - 再把旧对话折叠成 summary
   - 再把大文件正文退化为 path + excerpt + digest
   - 最后如果仍超预算，写 checkpoint 并续到下一轮，而不是硬把关键状态挤掉

## Current State

现有可复用能力：

- [task-supervisor.ts](/Users/admin/GitProjects/msgcode/src/runtime/task-supervisor.ts)
  - 已具备任务创建、恢复、取消、心跳续跑
- [heartbeat.ts](/Users/admin/GitProjects/msgcode/src/runtime/heartbeat.ts)
  - 已具备常驻 tick、异常自恢复、防重入
- [handlers.ts](/Users/admin/GitProjects/msgcode/src/handlers.ts)
  - 已有 `summaryContext` 注入
- [tool-loop.ts](/Users/admin/GitProjects/msgcode/src/agent-backend/tool-loop.ts)
  - 已有 `tool_result` 裁剪与历史摘要注入
- [bash-runner.ts](/Users/admin/GitProjects/msgcode/src/runners/bash-runner.ts)
  - 已有 stdout/stderr tail 裁剪

当前不足：

- 没有统一的“上下文预算装配器”
- 不同层的截断阈值分散，彼此不知道全局预算
- 长期任务依然缺少稳定 checkpoint 口径与交付判断口径

## Recommended Model

### 1. 任务分流

只保留两类：

- **普通聊天**
  - 当轮完成
  - 使用最近窗口 + summaryContext
- **长期任务**
  - 跨多轮 / 多工具 / 多阶段 / 多心跳
  - 必须有 durable task state
  - 推荐配合 `plan-files` 落 task-local 计划

不要引入第三种“plan mode”。

### 2. 上下文装配预算

推荐把每次请求的上下文预算切成 4 个槽位：

- **固定槽**（约 20-25%）
  - system prompt
  - soul
  - workspace / tool / skill hints

- **任务槽**（约 20-25%）
  - 任务 goal
  - acceptance criteria
  - current phase
  - next step
  - blocked reason

- **近期交互槽**（约 25-30%）
  - 最近几轮用户/助手消息

- **证据槽**（约 20-25%）
  - 必要 tool_result 摘要
  - 文件摘录
  - artifact 路径与小预览

- **保留槽**（约 10-15%）
  - 给模型输出和工具调用保留空间

重点：预算是“先分槽，再装配”，不是最后超了再乱裁。

### 3. 平滑溢出策略

按顺序退化：

1. **裁原始大输出**
   - 例如 `read_file`、`bash stdout`
   - 保留 preview + 路径 + digest

2. **折叠旧对话**
   - 把旧 turns 合并进 `summaryContext`
   - 保留当前任务和最近交互

3. **折叠长文件正文**
   - 从“整段正文”退化为“路径 + excerpt + 关键结论”

4. **写 checkpoint**
   - 若再超预算，就把当前阶段状态写入 task-local plan / task state
   - 下一轮从 checkpoint 恢复

这才是平滑，而不是单点 `slice(0, 4000)`。

### 4. 长期任务 checkpoint

每个长期任务至少要能恢复这些字段：

- `goal`
- `deliverable`
- `acceptanceCriteria`
- `currentPhase`
- `nextAction`
- `lastGoodEvidence`
- `blockedReason`（若有）

`TaskSupervisor` 继续做 durable state；
`plan-files` 负责把这些信息对模型可读地落到任务文件里。

### 5. memory 与 plan 的边界

- `memory`
  - 长期稳定事实
  - 用户偏好
  - 可跨任务复用

- `plan-files`
  - 当前任务推进与 checkpoint
  - 完成后可归档，但默认不是长期记忆

不要把任务过程塞进 memory。

## Implementation Order

### Phase 1: 统一预算装配口径

- 提炼单一的上下文预算配置
- 让 `summaryContext`、recent messages、tool previews 走同一装配器
- 先统一字符/片段预算，不急着做 token 级精算

### Phase 2: 长任务 checkpoint 收口

- 明确 `TaskRecord` 里哪些字段是恢复必需
- 明确 `plan-files` 与 `TaskSupervisor` 的配合口径
- 让长任务恢复时优先读取 checkpoint，而不是回灌过长历史

### Phase 3: 平滑溢出策略替换硬裁断

- 把分散的局部截断逐步收口到统一 budget policy
- 保留 source-level tail 裁剪，但最终是否注入模型交给统一装配器

### Phase 4: 观测与回归

- 为预算退化链增加最小日志
- 明确哪些请求因“超预算退化”被摘要/折叠/写 checkpoint

## Risks

- 风险 1：又做成新的 orchestration layer
  - 规避：不新增 mode，不新增 planner server，不新增二号 supervisor

- 风险 2：把所有普通聊天都升级成任务
  - 规避：长期任务仍以显式 `/task` 为 durable substrate

- 风险 3：以为大窗口等于不用做状态管理
  - 规避：大窗口只是缓冲，不是主存；主存仍是 task state + plan file + artifacts

- 回滚：
  - 若统一预算装配效果差，可先保持现有 local clip，逐模块回退
  - `plan-files` 与 `/task` 保持解耦，不影响现有普通聊天主链

## Evidence

- Code:
  - [task-supervisor.ts](/Users/admin/GitProjects/msgcode/src/runtime/task-supervisor.ts)
  - [heartbeat.ts](/Users/admin/GitProjects/msgcode/src/runtime/heartbeat.ts)
  - [handlers.ts](/Users/admin/GitProjects/msgcode/src/handlers.ts)
  - [tool-loop.ts](/Users/admin/GitProjects/msgcode/src/agent-backend/tool-loop.ts)
  - [bash-runner.ts](/Users/admin/GitProjects/msgcode/src/runners/bash-runner.ts)
  - [jobs/runner.ts](/Users/admin/GitProjects/msgcode/src/jobs/runner.ts)

评审意见：[留空,用户将给出反馈]
