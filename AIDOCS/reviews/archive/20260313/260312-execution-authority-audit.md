# 260312 抢执行权专项审查

## 结论

当前仓库里，真正会“抢模型执行权”的逻辑主要集中在四类：

1. 工具失败后直接终态化，原始错误直接变成用户答案
2. 模型给出的最终回答会被规则层改写、替换或二次裁决
3. 某些输入会在进入工具前被系统重写或拦截
4. 少量路由/策略层会在模型开跑前就替它做主决策

需要优先清理的是前两类；第三类里最硬的是 `SOUL.md` 路径纠偏；第四类要区分“显式策略边界”和“暗桩式猜测”。

## Findings

### P1 工具失败会被直接升级成最终用户答案

- 文件：`src/agent-backend/tool-loop.ts`
- 位置：
  - `1478-1530`
  - `2066-2119`
  - `1619-1621`
  - `2235-2237`

现状：

- tool call 一旦失败，系统立即构造 `forcedFinalState`
- 通过 `buildToolFailureAnswer()` 把 `TOOL_EXEC_FAILED / ENOENT / stderrTail` 直接包装成最终回复
- 当前轮次不再把失败结果回灌给模型继续思考

这会导致：

- 模型失去重试、换工具、改参数、换路径的机会
- 用户直接看到底层工具错误，而不是任务层结果

这次 `SOUL.md` 真实案例就是这样暴露出来的。

### P1 最终回答会被规则层替换为“伪最终答案”

- 文件：`src/agent-backend/tool-loop.ts`
- 位置：
  - `990-1040`
  - `1626-1629`
  - `2242-2245`

现状：

- 如果模型最终回答为空，或被判定包含协议残片
- 系统会调用 `buildToolLoopFallbackAnswer()`
- 直接根据最后一个工具结果拼装一个规则化答案

这意味着：

- 用户拿到的不一定是模型最终决定的回答
- 系统实际上在替模型“总结并交付”

典型例子：

- `read_file` 被改写成“读取成功，内容预览如下”
- `bash` 被改写成“命令执行完成（exitCode=...）”
- `write_file/edit_file` 被改写成“执行成功”

### P1 结束前监督员是实质上的第二裁判

- 文件：`src/agent-backend/tool-loop.ts`
- 位置：
  - `841-939`
  - `1648-1748`
  - `2266-2358`

现状：

- mutating tool 或“回答声称已完成副作用”时，会触发 `finish supervisor`
- supervisor 只允许输出 `PASS` 或 `CONTINUE`
- 连续三次 `CONTINUE` 后，系统会直接阻塞完成并向用户返回 `FINISH_SUPERVISOR_BLOCKED`
- supervisor 还能在模型输出无效时，借 `verify-pass-fallback` 直接放行

这不是观测层，而是明确的执行裁判层：

- 它能要求模型继续
- 它能否决模型结束
- 它能在某些情况下直接放行

### P1 未绑定聊天会被自动持久化绑定到 default workspace

- 文件：`src/router.ts`
- 位置：`78-105`

现状：

- 聊天未显式 `/bind` 时
- 系统会自动创建默认工作目录
- 并调用 `setRoute()` 把它持久化成真实绑定

这不是临时 fallback，而是替用户和模型做了一次真实路由决策。

风险：

- 用户和模型都可能以为“还没绑定”
- 实际系统已经把会话落到了默认 workspace
- 后续所有文件、SOUL、session 都会受这个猜测影响

### P1 任何以 `/` 开头的自然语言都可能先被命令层吞掉

- 文件：
  - `src/listener.ts`
  - `src/handlers.ts`
  - `src/routes/commands.ts`
- 位置：
  - `src/listener.ts:620-632`
  - `src/listener.ts:650-658`
  - `src/handlers.ts:495`
  - `src/routes/commands.ts:203-262`

现状：

- 文本只要以 `/` 开头，就优先进入 slash 命令体系
- 这会让绝对路径、路径举例、某些代码片段先被命令层解释

真实表现：

- 用户发 `/Users/admin/msgcode-workspaces/default/.msgcode/SOUL.md 这个呢`
- 系统先判成命令，返回“未知命令”

这属于输入层抢占，不是模型自己的误解。

### P1 `SOUL.md` 路径纠偏会重写工具参数

- 文件：`src/agent-backend/tool-loop.ts`
- 位置：`1118-1138`

现状：

- `normalizeSoulPathArgs()` 会对 `read_file.path` 做特殊改写
- 原本甚至会把任意以 `/SOUL.md` 结尾的路径都改成当前 workspace 的 `.msgcode/SOUL.md`

说明：

- 这不是提示词约束，而是直接修改模型提交的工具参数
- 本质上是系统替模型做路径决策

备注：

- 当前工作树里，这一条已经被收窄到只纠偏“当前 workspace 根目录误写的 SOUL.md”
- 但这仍然属于会抢执行权的一类逻辑，只是范围缩小了

### P2 `tooling.mode=explicit` 会在入口直接切断工具主链

- 文件：
  - `src/agent-backend/tool-loop.ts`
  - `src/tools/bus.ts`
- 位置：
  - `src/agent-backend/tool-loop.ts:1840-1865`
  - `src/tools/bus.ts:93-111`

现状：

- 如果 workspace policy 是 `explicit`
- `runAgentToolLoop()` 直接改走 `runAgentChat()` 纯文本链
- 同时 `tools/bus` 也会拒绝来自 `llm-tool-call` 的工具调用

这条属于显式策略边界，不是暗桩 bug，但它确实会完全抢走工具执行权。

### P2 SLO degrade 会在路由层替模型切换执行模型

- 文件：
  - `src/agent-backend/routed-chat.ts`
  - `src/slo-degrade.ts`
- 位置：
  - `src/agent-backend/routed-chat.ts:42-75`
  - `src/slo-degrade.ts:317-335`

现状：

- 路由层会读取 degrade state
- 然后用 `selectModelByDegrade()` 在 executor/responder 间切换模型

虽然当前已经不再在 degrade 模式下强制 `no-tool`
- 但模型选择仍然不是模型自己决定，而是 SLO 状态文件在决定

这条是策略层抢权，不是单轮 bug。

### P2 Tmux policy guard 会在模型前直接拦截执行臂

- 文件：`src/handlers.ts`
- 位置：`44-54`

现状：

- `kind=tmux && mode=local-only` 时
- `resolveTmuxPolicyBlockResult()` 直接返回错误
- 模型完全不会接到这条请求

这同样属于显式策略边界，不是隐藏逻辑，但确实是前置裁判。

### P2 verify phase 会把“简化假设”写成完成证据

- 文件：`src/agent-backend/tool-loop.ts`
- 位置：`83-166`

现状：

- `read_file` 直接假定成功即有效
- 大多数“其他工具”默认假定成功即有效
- verify 结果又会喂给 finish supervisor

这不是直接替模型回答用户，但它会影响 supervisor 的放行/阻塞判断，属于间接抢权。

### P3 Feishu 发送话术会被硬修正

- 文件：`src/agent-backend/tool-loop.ts`
- 位置：`956-988`

现状：

- 若 prompt 看起来像“发附件到飞书”
- 且模型回答里声称“已发送”
- 但没有 `feishu_send_file` 成功证据
- `hardenFeishuDeliveryClaim()` 会直接改写回答

这条比 `buildToolLoopFallbackAnswer()` 温和，因为它不是任意替换回答，而是只纠正特定虚假副作用声明。

但本质上仍然是系统在替模型改口。

## 分类判断

### 必须优先拆的硬抢权

1. 工具失败直接终态化
2. `buildToolLoopFallbackAnswer()` 规则化替代模型最终答案
3. finish supervisor 第二裁判
4. 未绑定自动持久化 default workspace
5. slash 命令优先吞掉以 `/` 开头的普通文本

### 可以保留但要显式承认是策略边界

1. `tooling.mode=explicit`
2. `tooling.require_confirm`
3. `local-only` 阻断 tmux
4. `owner-only` / whitelist
5. degrade 选模型

### 不算硬抢权，但属于强干预

1. `SOUL.md` 路径纠偏
2. Feishu 发送话术硬修正
3. verify phase 的“默认成功”假设

## 推荐清理顺序

1. 工具失败不再直接终态暴露给用户，先回灌模型
2. 删除 `buildToolLoopFallbackAnswer()`，不再由规则层伪造最终答案
3. 把 finish supervisor 降级为观测/诊断，而不是第二裁判
4. 取消“未绑定即自动持久化 default workspace”
5. 收口 slash 路由，避免把绝对路径文本误判成命令

