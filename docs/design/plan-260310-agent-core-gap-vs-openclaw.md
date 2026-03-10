# Agent Core 对标 OpenClaw 的收口方案

## Problem

`msgcode` 已经有：

- `launchd` 保活
- heartbeat
- task checkpoint
- summary / window / compact
- lane queue / steering queue

但这些能力仍然分散：

- 普通消息默认链路直接跑 `executeAgentTurn()`
- 长期任务只有显式 `/task` 才进 `TaskSupervisor`
- context 治理分散在 `handlers.ts`、`prompt.ts`、`tool-loop.ts`
- 还没有统一的 run lifecycle / wait / event stream

结果是：

**系统已经有长期任务零件，但还没有统一的 session-run runtime。**

## Occam Check

### 不加它，系统具体坏在哪？

- 复杂任务只有显式 `/task` 才更稳，普通消息中的复杂任务仍然容易停在半路
- future Web Surface / mobile 无法消费统一 run 状态
- context 管理继续散在多个文件里，长期只会越来越像 patch

### 用更少的层能不能解决？

能。  
不做 OpenClaw 式 gateway，不做 pairing，不做新的控制平面。  
只在现有 daemon 内补一个更薄的 `Run Core`，把现有 task / heartbeat / queue / context 收口。

### 这个改动让主链数量变多了还是变少了？

变少了。  
从“普通消息链 + `/task` 链 + heartbeat 链 + job 注入链”多条推进路径，收口成“统一 run lifecycle”一条主链。

## Alternatives

### 方案 A：继续沿用当前结构，局部补丁增强

做法：

- 继续补 `TaskSupervisor`
- 继续补 `summaryContext`
- 继续补 tool-loop 和 heartbeat

优点：

- 改动最小

缺点：

- 结构性问题不解决
- 运行模型继续分裂
- 越做越难接 surface / mobile

判断：

**不推荐。**

### 方案 B：在当前 daemon 内新增薄的 `Run Core`

做法：

- 不引入 gateway
- 不引入新进程
- 不引入多角色平台
- 只把所有 agent 执行统一抽象为 `run`

优点：

- 最符合当前阶段
- 最贴合“做薄”
- 能把已有零件真正焊起来

缺点：

- 需要对 task / handlers / commands / tool-loop 做一次核心收口

判断：

**推荐。**

### 方案 C：直接向 OpenClaw Gateway 形态靠拢

做法：

- 引入正式 gateway WS 协议
- pairing
- 客户端/节点
- remote control plane

优点：

- 终局能力完整

缺点：

- 过重
- 偏离当前阶段
- 会把重心从 Agent Core 拉到平台基础设施

判断：

**当前禁止。**

## Decision

选择 **方案 B：薄的 Run Core**。

核心理由：

1. 终局视角上，`msgcode` 确实需要像 OpenClaw 一样有强 session-run runtime
2. 但当前阶段不能把 OpenClaw 的 gateway 重量整套搬进来
3. 最小正确路径，是先把“每次运行都是正式对象”这件事做对

## 设计

### 核心定义

新增一个统一概念：

**Agent Run**

每次以下来源的执行，都必须成为正式 run：

- 普通入站消息
- `/task` 继续执行
- heartbeat
- schedule
- 后续 Web Surface 主动触发

### Run 需要具备的最小字段

- `runId`
- `sessionKey`
- `source`
  - `message`
  - `task`
  - `heartbeat`
  - `schedule`
  - `surface`
- `status`
  - `accepted`
  - `running`
  - `blocked`
  - `completed`
  - `failed`
  - `cancelled`
- `startedAt`
- `endedAt`
- `lastTool`
- `checkpointRef`
- `summaryRef`

### Session 需要具备的最小统一语义

当前不做 OpenClaw 那么重，但至少要补：

- `sessionKey` 不再只是临时 `chatId`
- route / workspace / channel 只负责映射到 session
- 当前 DM / group / job / heartbeat 的 session 语义明确

### Context Policy 需要统一收口

统一通过 `Run Core` 组装：

- summary
- recent window
- task checkpoint
- tool result preview
- memory
- compact / prune

要求：

- 任何上下文裁剪和 compaction 不再散落多点
- 都通过同一套 run/session policy 入口

### Event 模型

最小不需要 WebSocket 协议，也先不要做客户端系统。

但必须统一输出事件：

- `run:start`
- `run:tool`
- `run:block`
- `run:assistant`
- `run:end`
- `run:error`

第一阶段可先落文件事件或内存订阅，不要求完整外部协议。

## Plan

### Phase 1：统一 Run 记录

1. 新增 `run` 类型与持久化结构
2. 普通消息链、`/task`、heartbeat、schedule 都创建 run
3. `TaskSupervisor` 从“驱动执行器”退为“长期任务策略层”

验收：

- 每次 agent 执行都有 `runId`
- 普通消息不再是“无主执行”

### Phase 2：统一 Session Key

1. 抽 session key 解析
2. 将 route/workspace/channel -> session 语义显式化
3. 为未来 Telegram/Discord 保留统一入口

验收：

- 任何执行都能追溯到稳定 session key

### Phase 3：统一 Context Policy

1. 将当前 `summaryContext + window + compact + tool_result clip` 收口
2. 所有执行都走统一上下文装配器
3. task checkpoint 不再是单独拼接特例

验收：

- `handlers.ts` 不再单独维护一套 compaction 主逻辑
- task / normal message 的上下文装配逻辑一致

### Phase 4：统一 Run Events

1. 抽统一 run event
2. tool-loop / task / heartbeat 都发同一种 run 事件
3. 后续 surface 只消费这个事件层

验收：

- 后续页面或 CLI 不需要自己猜运行状态

### Phase 5：复杂任务 benchmark

设计一组长任务 benchmark：

- 多工具文件整理
- 浏览器 + 文件 + 汇总
- 需人工接力的长任务
- schedule 驱动任务

验收：

- 至少 3 类复杂任务可持续推进到完成或稳定 blocked

## Risks

### 风险 1：把 Run Core 做成新的厚控制层

缓解：

- 只做“统一运行对象 + 状态 + 上下文 + 事件”
- 不做 gateway、不做 pairing、不做平台

### 风险 2：一边做 Run Core，一边继续补旧链路

缓解：

- 明确目标是“减少主链数量”
- 每做一阶段就删掉旧特例

### 风险 3：session 设计不当，反而过早平台化

缓解：

- 只做最小 session key 与维护语义
- 暂不做 OpenClaw 式全量多端 session 系统

## Test Plan

1. 普通入站消息创建 run
2. `/task` 续跑创建 run
3. heartbeat 创建 run
4. schedule 创建 run
5. 同 session 串行保证
6. run event 顺序一致
7. context policy 在各入口一致

## 评审意见

[留空,用户将给出反馈]
