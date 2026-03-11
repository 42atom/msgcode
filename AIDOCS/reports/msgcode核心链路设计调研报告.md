# msgcode 核心链路设计调研报告

## 1. 调研目标

验证以下设计是否符合智能体工程最佳实践，并对照主流实现（OpenClaw、pi-mono）给出可落地建议：

1. `no-tool` 对话链路是否应携带 `SOUL/记忆上下文`。
2. `tool` 执行链路是否应最小化提示词，避免人格/风格干扰。
3. `complex-tool` 是否应拆分为 `plan -> act -> report` 三阶段。

---

## 2. 结论摘要

### 2.1 最重要结论

“对话核带 SOUL、执行核不带 SOUL”的三核思路是合理且推荐的，尤其适用于当前本地模型 tool-call 稳定性仍在爬坡阶段的 msgcode。

但该方案不是“零代价完美解”，落地必须同步补齐四个工程短板：

1. Exec -> Dialog 的状态回写机制（否则 report 丢细节）。
2. 三段串行导致的 TTFT 变慢（否则用户体感变差）。
3. 路由分类健壮性（否则误判导致链路抖动）。
4. 三核排障可观测性（否则问题难定位）。

### 2.2 与 OpenClaw / pi-mono 的关系

1. **OpenClaw 默认主链路是统一上下文**（full prompt 注入 bootstrap 文件，包括 `SOUL.md`），但对 subagent/cron 明确切换 `minimal` 模式并缩减注入。
2. **pi-mono 默认也是单会话工具循环**（同一 `systemPrompt + tools + messages` 上下文下执行 tool loop）。
3. 二者都证明了“可运行的主流方案”不必天然双核；但也都提供了“最小化子链路”的机制（OpenClaw 的 `promptMode=minimal`），这为 msgcode 做双核重构提供了直接参考。

---

## 3. 对照证据（源码级）

## 3.1 OpenClaw 证据

### 3.1.1 Prompt 模式分层

- `src/agents/system-prompt.ts`
  - 定义 `PromptMode = "full" | "minimal" | "none"`。
  - `minimal` 会省略多类高成本章节（如 Skills/部分运营性章节），用于子代理场景。

### 3.1.2 主链路 prompt 组装

- `src/agents/pi-embedded-runner/run/attempt.ts`
  - 根据 session key 选择 prompt 模式：
    - subagent/cron -> `minimal`
    - 其他 -> `full`
  - 将 `skillsPrompt`、`contextFiles`、tools、runtime 信息统一送入 `buildEmbeddedSystemPrompt(...)`。

### 3.1.3 Bootstrap 注入

- `src/agents/bootstrap-files.ts`
  - `resolveBootstrapContextForRun(...)` 生成注入上下文文件。
- `src/agents/system-prompt.ts`
  - 将 `contextFiles` 注入 `# Project Context`。
  - 若检测到 `SOUL.md`，会显式提示模型遵循 persona/tone。

### 3.1.4 Subagent 的最小化注入

- `src/agents/workspace.ts`
  - `filterBootstrapFilesForSession(...)` 对 subagent/cron 只保留：
    - `AGENTS.md`
    - `TOOLS.md`
  - `SOUL.md` 默认不进入 subagent 的 minimal bootstrap 注入。

### 3.1.5 技能注入策略

- `src/agents/skills/workspace.ts`
  - 引用 `@mariozechner/pi-coding-agent` 的 `formatSkillsForPrompt(...)`。
  - 注入的是 `<available_skills>` 索引块，而不是整份技能正文。
  - 通过 `read` 再按需加载 `SKILL.md` 细节。

---

## 3.2 pi-mono 证据

### 3.2.1 技能索引注入

- `packages/coding-agent/src/core/skills.ts`
  - `formatSkillsForPrompt(...)` 输出 `<available_skills>`。
  - 明确要求：任务匹配时使用 `read` 加载技能文件。

### 3.2.2 系统提示词拼装

- `packages/coding-agent/src/core/system-prompt.ts`
  - 将 `skills` 区块附加到系统提示词（前提是 read tool 可用）。

### 3.2.3 工具循环执行

- `packages/agent/src/agent-loop.ts`
  - LLM 调用上下文一次性包含 `systemPrompt/messages/tools`。
  - 发现 tool calls 后执行 `executeToolCalls(...)`，再将 toolResult 消息继续回灌同一会话流。

---

## 4. msgcode 当前状态与问题定位

基于当前仓库实现（`/Users/admin/GitProjects/msgcode`）：

1. `SOUL` 当前主要在 `runLmStudioToolLoop` 注入。
2. `no-tool` 分支走 `runLmStudioChat`，未显式携带 `soulContext`。
3. 出现“工具链路带 SOUL、纯对话链路不带 SOUL”的职责倒置。

这与“SOUL 服务对话表达、执行链路追求确定性”的目标不一致。

---

## 5. 推荐架构（msgcode 目标态）

## 5.1 三核职责

1. **Dialog Kernel（对话核）**
   - 输入：`SOUL + memory + summary + user intent`
   - 输出：面向用户的自然语言（计划/解释/汇报）
2. **Execution Kernel（执行核）**
   - 输入：最小任务指令 + tool schema + policy
   - 输出：结构化工具结果
   - 约束：默认不注入 SOUL
3. **Orchestrator（编排核）**
   - 管理 `no-tool/tool/complex-tool` 路由
   - 控制 `plan -> act -> report` 阶段流

## 5.2 路由与注入规则

1. `no-tool`: `dialog kernel`，`soulInjected = true`
2. `tool`:
   - 可以由 dialog 做简短任务理解
   - act 阶段使用 `exec kernel`，`soulInjected = false`
   - 结果汇报回 `dialog kernel`，`soulInjected = true`
3. `complex-tool`:
   - `plan`（dialog, soul=true）
   - `act`（exec, soul=false）
   - `report`（dialog, soul=true）

## 5.3 状态回写契约（Exec -> Dialog）

不建议把“思考日志”硬塞进每个工具 schema；推荐由编排核维护统一 `action_journal`，作为 report 阶段唯一事实源：

1. `traceId`
2. `stepId`
3. `intent`（本步目标）
4. `tool`
5. `argsDigest`（参数摘要，避免泄漏大文本）
6. `ok/exitCode/errorCode`
7. `stdoutTail/stderrTail/fullOutputPath`
8. `durationMs`

report 阶段只消费 `action_journal` + 用户原始问题，禁止直接“猜测执行过程”。

---

## 6. 与 OpenClaw 的可借鉴点

1. 保留统一会话的工程简洁性，但引入明确 `promptMode` 分层。
2. 对“长链路/子代理”采用 `minimal` 提示词，降低噪声与 token 成本。
3. 技能一律索引注入 + 按需读取，避免 system prompt 膨胀。
4. 用 session/sessionKey 控制上下文粒度，而不是在业务逻辑层反复硬编码 if/else。

---

## 7. 实施建议（重构而非热修）

## 7.1 建议任务序列

1. `R0`: 先补防幻觉硬门（tool 路由下 `toolCallCount=0` 不允许伪执行文案通过）
2. `R1`: 抽离 prompt builder（dialog / exec 两套 builder）
3. `R2`: 路由层改造（no-tool/tool/complex-tool 显式 phase）
4. `R3`: tool loop 去人格化（移除 SOUL 注入）
5. `R4`: 状态回写落地（`action_journal` + report 消费契约）
6. `R5`: TTFT 补偿（进入 plan/act 立刻发送固定“处理中”短回执）
7. `R6`: 回归锁与观测字段固化

## 7.2 路由健壮策略（避免 Orchestrator 误判）

建议采用“规则 + 不确定性降级”：

1. 先做轻量规则判定（关键词/命令形态/上下文长度）。
2. 若置信度低，优先走 `no-tool` 并反问澄清，而非盲目进入 complex-tool。
3. 对高风险执行（写文件/删除/长命令）要求显式确认或二次判定。
4. 保留人工降级开关：连续协议失败时强制 `LEVEL_2`（纯文本模式）。

## 7.3 强制观测字段

每轮至少记录：

1. `route`: no-tool | tool | complex-tool
2. `phase`: plan | act | report
3. `kernel`: dialog | exec
4. `soulInjected`: boolean
5. `toolCallCount`, `toolNames`, `toolErrorCode`（如有）

---

## 8. 验收门禁（建议）

1. `no-tool` 请求日志中必须出现 `kernel=dialog && soulInjected=true`
2. `tool-act` 请求日志中必须出现 `kernel=exec && soulInjected=false`
3. `complex-tool` 三阶段日志顺序必须为 `plan -> act -> report`
4. 二轮收口必须可展示（防止“工具成功但无最终文本”）
5. 全量 `tsc/test/docs:check` 通过
6. tool 路由出现 `toolCallCount=0` 时必须返回协议失败提示，不得冒充已执行
7. report 内容必须可由 `action_journal` 字段反向核验（可追溯）

---

## 9. 评审意见吸收后的落地补丁

本章节对应“工程落地四大痛点”补救：

1. 记忆同步复杂：通过 `action_journal` 契约回写，report 只读事实，不读猜测。
2. TTFT 变慢：进入 plan/act 立即发短回执，后台继续执行三阶段。
3. Orchestrator 智商压力：加置信度策略和不确定性降级，避免误判放大。
4. 运维复杂度上升：强制 `traceId + route + phase + kernel + soulInjected` 日志锚点。

这意味着三核方案是“有成本但可控”的演进路径，而非一次性完美重构。

---

## 10. 参考资料

## 10.1 OpenClaw

1. 文档：[https://docs.openclaw.ai/concepts/system-prompt](https://docs.openclaw.ai/concepts/system-prompt)
2. 本地证据仓库：`/Users/admin/GitProjects/GithubDown/openclaw`
3. 关键源码证据（本地绝对路径）：
   - `/Users/admin/GitProjects/GithubDown/openclaw/src/agents/system-prompt.ts`
   - `/Users/admin/GitProjects/GithubDown/openclaw/src/agents/pi-embedded-runner/run/attempt.ts`
   - `/Users/admin/GitProjects/GithubDown/openclaw/src/agents/bootstrap-files.ts`
   - `/Users/admin/GitProjects/GithubDown/openclaw/src/agents/workspace.ts`
   - `/Users/admin/GitProjects/GithubDown/openclaw/src/agents/skills/workspace.ts`

## 10.2 pi-mono

1. 本地证据仓库：`/Users/admin/GitProjects/GithubDown/pi-mono`
2. 关键源码证据（本地绝对路径）：
   - `/Users/admin/GitProjects/GithubDown/pi-mono/packages/coding-agent/src/core/skills.ts`
   - `/Users/admin/GitProjects/GithubDown/pi-mono/packages/coding-agent/src/core/system-prompt.ts`
   - `/Users/admin/GitProjects/GithubDown/pi-mono/packages/agent/src/agent-loop.ts`

## 10.3 msgcode（当前）

1. `/Users/admin/GitProjects/msgcode/src/lmstudio.ts`
2. `/Users/admin/GitProjects/msgcode/src/handlers.ts`
3. `/Users/admin/GitProjects/msgcode/src/config/souls.ts`
