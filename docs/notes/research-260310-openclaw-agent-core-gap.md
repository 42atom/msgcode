# OpenClaw 对标下的 Agent Core 差距研究

## 问题

用户当前最关心的不是更多页面、更多通道，而是：

**`msgcode` 距离“像 OpenClaw 一样能稳定完成复杂任务、持续活跃”还差什么。**

这份研究只讨论 `Agent Core`，不讨论移动端和页面交付。

## 结论先行

`msgcode` 和 `openclaw` 的差距，不在“功能数量”，而在 **运行模型**。

更准确地说：

- `openclaw` 的核心是 **session-run runtime**
- `msgcode` 当前更像 **消息驱动 + 局部长期任务补丁**

因此差距主要集中在 5 个方面：

1. **每次 agent 运行还不是一等公民**
2. **session 模型还不够强，chat/workspace/task 还没完全收口成统一会话真相源**
3. **上下文治理已有进展，但仍是分散补丁，不是统一 session policy**
4. **缺少可消费的 run-level lifecycle / streaming 事件层**
5. **复杂任务的长期推进能力还主要依赖显式 `/task`，没有覆盖默认主链**

一句话：

**OpenClaw 的强，不是“会更多”，而是“每次运行都被当成一个可追踪、可等待、可恢复、可观测的 session run”。**

## OpenClaw 的核心强点

### 1. Agent loop 是第一公民

OpenClaw 文档把一次 agent 运行定义得非常明确：

- intake
- context assembly
- model inference
- tool execution
- streaming replies
- persistence

并且每次运行都有：

- `runId`
- `acceptedAt`
- `agent.wait`
- lifecycle end/error

这意味着：

**一次运行不是“顺手调用一下模型”，而是正式的 runtime 单元。**

来源：

- `docs/concepts/agent-loop.md`
- `docs/concepts/architecture.md`

### 2. Session 是第一公民

OpenClaw 的 session 模型非常完整：

- DM 与 group 有明确 session key 规则
- session state 由 gateway 统一持有
- 有 reset / expiry / maintenance / cleanup
- 有 session pruning / compaction / main session / per-peer isolation

这意味着：

**它不是“chatId + 一些历史文件”，而是有明确定义的会话系统。**

来源：

- `docs/concepts/session.md`
- `docs/concepts/session-pruning.md`
- `docs/concepts/compaction.md`

### 3. 队列与串行化是主链能力

OpenClaw 把并发问题收口得很明确：

- per-session lane
- global lane
- queue mode
- `agent.wait`

这保证：

- 同一 session 只有一个真实 run 在推进
- 不同 session 可以受控并发

来源：

- `docs/concepts/agent-loop.md`
- `docs/concepts/queue.md`

### 4. Lifecycle / streaming 是正式协议能力

OpenClaw 有明确的：

- lifecycle events
- assistant stream
- tool stream
- wait 语义

这不只是“前端更酷”，而是让：

- CLI
- WebChat
- future mobile
- automation

都能消费同一条 run 事件流。

来源：

- `docs/concepts/agent-loop.md`
- `docs/concepts/streaming.md`
- `docs/concepts/architecture.md`

### 5. Context 管理是完整的 session policy

OpenClaw 不只做“截断”：

- compaction 持久写入 session history
- session pruning 只修剪 tool results
- pre-compaction memory flush
- model-specific context window policy

所以：

**它把“长会话如何不崩”做成了 session runtime 的正式能力。**

来源：

- `docs/concepts/compaction.md`
- `docs/concepts/session-pruning.md`
- `docs/concepts/memory.md`

## msgcode 当前的真实状态

### 1. 我们已经有的优点

先说已经做对的部分。

#### 1.1 已有常驻与保活基础

- `launchd` 已接入
- `HeartbeatRunner` 已有
- daemon 已可被系统托管

来源：

- `src/runtime/heartbeat.ts`
- `src/runtime/launchd.ts`
- `docs/design/plan-260310-msgcode-daemon-keepalive-via-launchd.md`

#### 1.2 已有显式长期任务基础

- `TaskSupervisor`
- task checkpoint
- `/task run/status/resume/cancel`

来源：

- `src/runtime/task-supervisor.ts`
- `src/runtime/task-types.ts`

#### 1.3 已有上下文平滑收口的第一步

- `summaryContext`
- recent window
- 自动 compact
- `buildConversationContextBlocks()`
- tool_result clip

来源：

- `src/handlers.ts`
- `src/agent-backend/prompt.ts`
- `src/agent-backend/tool-loop.ts`
- `docs/design/plan-260310-long-running-agent-context-smoothing.md`

#### 1.4 已有 lane queue / steering queue 雏形

- `commands.ts` 有 per-chat lane queue
- `steering-queue.ts` 有 followUp / steer
- `event-queue-store.ts` 有持久化恢复

来源：

- `src/commands.ts`
- `src/steering-queue.ts`
- `src/runtime/event-queue-store.ts`

这些都说明：

**`msgcode` 并不是没有 Agent Core，而是已经长出了一半。**

### 2. 关键差距

#### 差距一：普通消息还不是正式的 run 对象

这是最大的差距。

当前 `msgcode` 的默认链路仍然是：

- listener 收到消息
- 直接组装窗口和摘要
- 调 `executeAgentTurn()`
- 直接拿答案回消息

虽然有 traceId，但没有正式的：

- runId
- accepted
- wait
- lifecycle end/error
- run event stream

而显式长期任务则走另外一套：

- `/task run`
- `TaskSupervisor`
- heartbeat 续跑

这意味着：

**默认对话链和长期任务链还是分开的。**

证据：

- `src/handlers.ts`
- `src/runtime/task-supervisor.ts` 注释明确写了：`仅显式 /task run <goal>`

#### 差距二：TaskSupervisor 只覆盖显式任务，不覆盖默认主链

`TaskSupervisor` 当前的设计很明确：

- heartbeat 只续跑显式创建的 task
- 不扫描普通消息
- 单 chat 单活跃任务

这很好，但也说明：

**系统默认不会把普通复杂任务自动纳入长期推进体系。**

所以现在复杂任务经常取决于：

- 模型这轮是否刚好做完
- 上下文是否刚好没炸
- 工具这轮是否刚好命中

而不是由统一 runtime 保证推进。

证据：

- `src/runtime/task-supervisor.ts`
- `src/runtime/task-types.ts`

#### 差距三：session 模型还偏弱

当前 `msgcode` 的核心真相源更多是：

- route
- workspace
- chatId
- window
- summary

但还没有像 OpenClaw 那样收口成一套明确 session key / maintenance / lifecycle / cleanup policy。

这会带来两个问题：

1. 对将来的 Telegram/Discord/多入口，session 语义不够稳
2. 长时运行依赖更多临时拼接而非正式 session 运行模型

证据：

- `src/routes/*`
- `src/session-window.ts`
- `src/summary.ts`
- 对比 `openclaw/docs/concepts/session.md`

#### 差距四：context 治理已经有了，但还散

`msgcode` 现在已经做了不少对的事：

- context budget observation
- 70% 自动 compact
- summary + recent window
- tool_result clip

但这些逻辑还分散在：

- `handlers.ts`
- `prompt.ts`
- `tool-loop.ts`

也就是说：

**现在更像“多处局部止血”，还不是 session runtime 的统一上下文策略。**

证据：

- `src/handlers.ts`
- `src/agent-backend/prompt.ts`
- `src/agent-backend/tool-loop.ts`
- `docs/design/plan-260310-long-running-agent-context-smoothing.md`

#### 差距五：缺少 run-level 事件层

这对现在看似不是核心，但对未来是核心。

没有 run-level lifecycle/event stream，就意味着：

- 前端/页面无法稳定观察任务推进
- future mobile 无法可靠订阅状态
- CLI / web / surface 很难消费同一条运行主链

OpenClaw 强的地方恰好在这里：

- 所有表面都围绕同一 run event 流

而 `msgcode` 目前更多只有：

- 文件日志
- 最终回复
- 少量中间观测

证据：

- `src/agent-backend/tool-loop.ts`
- `src/handlers.ts`
- 对比 `openclaw/docs/concepts/agent-loop.md`

## 这意味着什么

如果从终局往回看：

`msgcode` 当前的问题不是“还少一个更强的模型”。

真正的问题是：

**Agent Core 还没有把所有运行统一收口成“正式的 session run”。**

所以现在会出现这些现象：

- 复杂任务只有显式 `/task` 才更稳
- 普通消息里的复杂任务仍容易“做一半”
- 上下文治理靠多处 patch
- 未来 surface/mobile 还拿不到统一运行事件

## 推荐方案方向

推荐不是“抄 OpenClaw gateway”，而是：

**在 `msgcode` 现有 daemon 内，补一个更薄的 `Run Core`。**

这个 `Run Core` 只做 4 件事：

1. 把每次 agent 执行都变成正式 run
   - 普通消息
   - `/task`
   - heartbeat
   - schedule

2. run 与 session 解耦于具体通道
   - chat / channel 只是入口
   - session 是统一真相源

3. 所有上下文治理收口到 run/session policy
   - recent window
   - summary
   - checkpoint
   - tool result preview
   - compaction

4. 输出统一 run events
   - start
   - tool
   - assistant
   - blocked
   - end
   - error

这样未来：

- 页面
- Web Surface
- 原生壳
- 聊天通知

都可以只是消费同一条 core 主链，而不是逼 core 再重做一次。

## 最值得学的，不是 OpenClaw 的 gateway，而是这些原则

1. 一次运行是一等公民
2. session 是一等公民
3. 队列和并发是主链能力
4. context 管理是 session policy，不是零散 patch
5. event stream 是未来 surface 的基础

## 最终判断

`msgcode` 现在离 OpenClaw 的差距，可以概括成一句：

**我们已经有了 task core、heartbeat、context smoothing 的零件；但还没有把它们焊成一个统一的 session-run runtime。**

这就是后续 Agent Core 主线最该补的地方。

## 证据

### Docs

- `/Users/admin/GitProjects/GithubDown/openclaw/docs/concepts/agent-loop.md`
- `/Users/admin/GitProjects/GithubDown/openclaw/docs/concepts/session.md`
- `/Users/admin/GitProjects/GithubDown/openclaw/docs/concepts/queue.md`
- `/Users/admin/GitProjects/GithubDown/openclaw/docs/concepts/compaction.md`
- `/Users/admin/GitProjects/GithubDown/openclaw/docs/concepts/session-pruning.md`
- `/Users/admin/GitProjects/GithubDown/openclaw/docs/concepts/memory.md`
- `/Users/admin/GitProjects/GithubDown/openclaw/docs/concepts/streaming.md`
- `/Users/admin/GitProjects/GithubDown/openclaw/docs/concepts/architecture.md`

### Code

- `/Users/admin/GitProjects/msgcode/src/runtime/task-supervisor.ts`
- `/Users/admin/GitProjects/msgcode/src/runtime/task-types.ts`
- `/Users/admin/GitProjects/msgcode/src/runtime/heartbeat.ts`
- `/Users/admin/GitProjects/msgcode/src/agent-backend/prompt.ts`
- `/Users/admin/GitProjects/msgcode/src/agent-backend/tool-loop.ts`
- `/Users/admin/GitProjects/msgcode/src/handlers.ts`
- `/Users/admin/GitProjects/msgcode/src/commands.ts`
- `/Users/admin/GitProjects/msgcode/src/steering-queue.ts`

