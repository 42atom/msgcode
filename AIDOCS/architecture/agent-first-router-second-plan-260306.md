# Agent-First / Router-Second 最小改造方案

## 结论

当前问题的根因不是 `browser` 工具本身，而是主链多了一层“前置路由判定”：

1. 用户消息先经过 `route classifier`
2. 被判成 `no-tool` 时，模型根本没在完整工具上下文里做决策
3. 之后只能靠伪 tool marker 检测再回退到 tool-loop

这和 Codex 式“单一智能体先看到工具，再自己决定是否调用”不一致。

**改造目标**：
- 去掉前置主裁判式 route classifier
- 保留单一智能体主链
- 模型自己决定：直答 or `tool_calls`
- router 退化为观测/降级/少量兜底，而不是前置决策器

## 要改成什么

### 新主链（目标形态）

1. 用户消息进入统一 Agent 主链
2. 系统注入：
   - system prompt
   - SOUL / window / summary
   - tools manifest
3. 模型在完整上下文里自己决定：
   - 直接输出最终文本
   - 或返回 `tool_calls`
4. 若有 `tool_calls`：
   - 进入 tool-loop
   - 执行工具
   - 回灌结果
   - verify
   - report
5. 若无 `tool_calls`：
   - 直接视为 `no-tool` 结果

### Router 保留但降级

router 不再负责“替模型决定这条消息能不能看见工具”，只负责：

1. 观测
   - 记录是模型直答还是进入 tool-loop
2. 降级
   - 例如 provider 不支持工具、SLO degrade、工具总线关闭时，强制 no-tool
3. 极少量 fallback
   - 明确命令型或系统异常时的兜底路径

## 最小改造范围

### 1. `src/agent-backend/routed-chat.ts`

当前：
- 先 `classifyRouteModelFirst()`
- 再根据 `route` 分流到 no-tool/tool/complex-tool

改成：
- 默认不跑 `classifyRouteModelFirst()`
- 统一先调用一个“agent-first 主入口”
- 由模型首轮自己决定是否产生 `tool_calls`

保留：
- degrade 模式
- 日志字段
- `complex-tool` 的 plan/act/verify/report 流程

删除/降级：
- `ROUTE_CLASSIFIER_SYSTEM_PROMPT` 不再作为默认主入口
- `classifyRouteModelFirst()` 只保留为 debug/实验/观测，不参与默认主链

### 2. `src/agent-backend/tool-loop.ts`

当前：
- 只在进入 `tool` 路由后才运行

改成：
- 允许作为“统一 agent 主链”的首轮解析器
- 首轮请求默认带完整 `tools[]`
- 如果模型直接返回文本且无 `tool_calls`：
  - 返回 `no-tool` 结果
- 如果返回 `tool_calls`：
  - 继续现有 tool-loop

关键点：
- `tool_choice=auto`
- 不需要前面先分类

### 3. `src/agent-backend/types.ts`

需要新增或收口：

1. 统一主链结果类型
   - `decision: "no-tool" | "tool"`
2. 把现在的 `route` 从“前置分类结果”改成“最终执行结果语义”

也就是说：
- `route` 不再表示“router 替模型预判出来的路线”
- 而表示“本轮最终走出的执行形态”

### 4. `src/handlers.ts`

当前：
- 通过 `runAgentRoutedChat()` 走 pre-route 逻辑

改成：
- 仍然调用 `runAgentRoutedChat()` 这个名字也行
- 但其内部语义要变成“统一 agent 主链”
- `handlers` 不需要感知 `route classifier`

## 冻结边界（不要扩 scope）

这轮只做：

1. 去掉前置主裁判式 route classifier
2. 收口成单智能体自决策主链
3. 保持已有：
   - manifest 工具说明书
   - tool-loop
   - verify gate
   - task-supervisor

这轮不做：

1. 不改 `browser` 工具合同
2. 不改配额默认值
3. 不改多任务/多代理
4. 不顺手重写 prompt 全套
5. 不加新的自然语言强绑定规则

## 验收标准

### 必过行为

1. 用户发自然语言请求时，默认先进入“看得见工具的主智能体”
2. 模型可自行决定不调用工具，直接回答
3. 模型也可自行决定调用 `browser/bash/read_file/...`
4. 不再存在：
   - 先被判成 `no-tool`
   - 再靠 fake tool marker recover 到 tool-loop
   这种主流程

### 日志口径

日志应能明确区分：

1. `decisionSource=model`
2. `decision=no-tool|tool`
3. `toolCallCount`
4. `degradeApplied`

### 真实 smoke

至少跑两条：

1. 自然语言纯问答
   - 模型直接答，不调工具
2. 自然语言网页任务
   - 模型自行决定调用 `browser`

## 实施顺序

1. 先改 `routed-chat.ts`
   - 去掉默认 pre-classifier 主路径
2. 再改 `tool-loop.ts`
   - 支持首轮 auto 决策
3. 再改 `types.ts`
   - 收口结果语义
4. 再补测试
   - 不允许回退到旧 pre-route 主链

## 一句话给执行同学

别再让 router 先替模型做主判断；默认主链必须是“单一智能体先看到工具，再自己决定直答还是 tool-calls”。
