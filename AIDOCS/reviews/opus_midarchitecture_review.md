# msgcode 架构 vs GPT5.4 Harness 设计思想比对

文档提出了 agent harness 的 5 层模型和 5 条产品原则。以下逐条对照 msgcode 的实际实现，标注对齐/偏差/有意取舍。

---

## 一、5 层模型比对

### 1. Agent Core — 目标分解、工具调度、执行决策、状态更新

| 文档期望 | msgcode 实现 | 评价 |
|---|---|---|
| 有状态的任务执行体 | [task-supervisor.ts](file:///Users/admin/GitProjects/msgcode/src/runtime/task-supervisor.ts) + [heartbeat-tick.ts](file:///Users/admin/GitProjects/msgcode/src/runtime/heartbeat-tick.ts) 构成 heartbeat 驱动的执行循环 | ✅ 对齐 |
| 目标分解 | `issues/` 目录里的任务文档 + front matter（parent/child、assignee、state）| ✅ 用文件系统做分解，Unix 味足 |
| 工具调度 | [tools/bus.ts](file:///Users/admin/GitProjects/msgcode/src/tools/bus.ts) → [tools/handlers.ts](file:///Users/admin/GitProjects/msgcode/src/tools/handlers.ts) → skill SKILL.md | ✅ 清晰的 manifest → handler → LLM 主链 |
| 状态更新 | 文件名状态机 `tdo→doi→rvw→pss→dne`，dispatch JSON，subagent JSON | ✅ 文件即状态，可 git track |

> [!TIP]
> 这一层是 msgcode 最扎实的部分。任务文档即状态、文件名编码状态机、dispatch 落盘，全部可人工审查。

---

### 2. State / Memory Layer — 长任务进度、决策记录、session 恢复

| 文档期望 | msgcode 实现 | 评价 |
|---|---|---|
| progress file | [WorkCapsule](file:///Users/admin/GitProjects/msgcode/src/runtime/work-continuity.ts#83-117) + `TaskCheckpoint` 持久化到 dispatch JSON | ✅ 有 |
| feature list / structured state | `issues/` 任务文档 + front matter | ✅ 有 |
| git history | [advanceTaskState](file:///Users/admin/GitProjects/msgcode/src/runtime/heartbeat-tick.ts#291-371) 优先用 `git mv` | ✅ 有意识利用 git |
| 决策记录 | 无显式 `decisions.md` 类文件 | ⚠️ 缺口 |
| failures.log | `sameErrorCodeStreakCount` + `lastErrorCode` 在 TaskRecord 里 | ⚠️ 有计数但无持久化失败轨迹 |
| session 恢复 | [buildWorkRecoverySnapshot](file:///Users/admin/GitProjects/msgcode/src/runtime/work-continuity.ts#749-848) 冷启重建 WorkCapsule | ✅ 做了 |
| verification.md | 无显式验证记录工件 | ⚠️ 缺口 |

> [!NOTE]
> 文档建议维护 `mission.md / progress.json / decisions.md / verification.md / failures.log`。msgcode 把大部分信息压进了 dispatch JSON 和 TaskRecord 字段里，**信息量够但可读性不如文本文件**。这符合"做薄"原则，但对人类事后审计不够友好。

---

### 3. Harness Layer — 规则约束、预算、loop detection、权限管理

| 文档期望 | msgcode 实现 | 评价 |
|---|---|---|
| 架构规则/约束 | [AGENTS.md](file:///Users/admin/GitProjects/msgcode/AGENTS.md) 语义约束，不做硬编码拦截 | ✅ 有意为之——用说明书代替控制层 |
| linter / CI checks | 无内建 linter 集成 | ❌ 无 |
| 预算分配 | [budget.ts](file:///Users/admin/GitProjects/msgcode/src/budget.ts)（context window token 预算）+ [task-supervisor.ts](file:///Users/admin/GitProjects/msgcode/src/runtime/task-supervisor.ts) 里的 `maxAttempts` / `SAME_TOOL_SAME_ARGS_RETRY_LIMIT` | ✅ 两级预算 |
| loop detection | `sameToolSameArgsRetryCount` ≥ 2 + `sameErrorCodeStreakCount` ≥ 3 → `BUDGET_EXHAUSTED` | ✅ 实现了轻量层 doom loop 检测 |
| 工具权限管理 | [security.ts](file:///Users/admin/GitProjects/msgcode/src/security.ts) + [desktop-permissions-preauth.ts](file:///Users/admin/GitProjects/msgcode/src/runtime/desktop-permissions-preauth.ts) + 三类硬边界（安全/预算/物理）| ✅ 有 |
| 错误恢复 | 明确不做自动恢复层，错误回给模型 | ✅ 有意取舍 |

> [!IMPORTANT]
> **这是 msgcode 与文档最大的理念分歧点。** 文档主张"把规范编译成约束"——让跨层调用无法通过检查。msgcode 的 [AGENTS.md](file:///Users/admin/GitProjects/msgcode/AGENTS.md) 明确反对这种做法："禁止新增前置裁判层、finish supervisor 代决层"。msgcode 选择让 LLM 自己做对，而不是用机器强制。这是一个深思熟虑的取舍，不是疏忽。

---

### 4. Verification Layer — 测试、运行时检查、页面验证

| 文档期望 | msgcode 实现 | 评价 |
|---|---|---|
| 自动验证 | `probe/` 模块提供诊断探针 | 🟡 探针存在但不是 verifier-first |
| 真实环境 | 浏览器（`patchright-browser`）、shell、桌面 (`ghost-mcp`) | ✅ 能力暴露充分 |
| 页面截图/DOM | `patchright-browser` SKILL.md | ✅ 有 |
| 自举冒烟测试 | [AGENTS.md](file:///Users/admin/GitProjects/msgcode/AGENTS.md) 明确要求真实飞书通道冒烟 | ✅ 有意识 |
| 自动选择验证器 | 无任务类型→验证器的自动映射 | ❌ 缺口 |
| Definition of Done | `acceptance` 字段在 dispatch 和任务文档里 | ✅ 有 |

> [!WARNING]
> 文档说"先做 verifier，再做 planner"，认为验证是 agent 最薄弱环节。msgcode **有验收标准（acceptance）但缺少自动验证闭环**——子代理做完后用 done marker 标记，但不会自动跑测试/lint/build 来验证产出。这可能是当前最值得补的一块。

---

### 5. Reflection / Improvement Layer — 失败归因、trace analysis、规则迭代

| 文档期望 | msgcode 实现 | 评价 |
|---|---|---|
| 失败归因 | `lastErrorCode` + `sameErrorCodeStreakCount` | 🟡 有计数，无归因分析 |
| trace analysis | 日志在 `~/.config/msgcode/log` | 🟡 有日志，无自动分析 |
| harness 规则迭代 | 无自动生成 guardrails 的能力 | ❌ 无 |
| 知识库清理 | 无 | ❌ 无 |
| critic/reviewer agent | 无独立审查角色 | ❌ 无 |

> [!NOTE]
> Reflection 层是文档里最"长期"的一层，msgcode 选择不做是合理的阶段决策。但日志已经在了（`~/.config/msgcode/log`），若将来想做失败归因/trace分析，基础设施是有的。

---

## 二、5 条产品原则比对

### 原则 1：有状态的任务执行体
**msgcode 对齐度：✅ 高。** [TaskRecord](file:///Users/admin/GitProjects/msgcode/src/runtime/subagent.ts#225-229) + [WorkCapsule](file:///Users/admin/GitProjects/msgcode/src/runtime/work-continuity.ts#83-117) + 文件状态机 = work state，不是 session。

### 原则 2：memory 外部化、结构化
**msgcode 对齐度：🟡 部分对齐。** 信息在 JSON 里结构化了，但不是人类友好的 markdown 工件。[context-policy.ts](file:///Users/admin/GitProjects/msgcode/src/runtime/context-policy.ts) 做了上下文裁剪，相当于 memory 管理的一部分。

### 原则 3：anti doom loop
**msgcode 对齐度：✅ 已实现轻量层。** `sameToolSameArgsRetryCount` + `sameErrorCodeStreakCount`。但只做了文档中的"轻量层"，未做"中间层"（强制重述问题）和"重型层"（独立 critic agent）。

### 原则 4：verifier-first
**msgcode 对齐度：⚠️ 最弱的一环。** 有 acceptance 标准和 done marker，但没有自动验证器（lint/test/build/e2e 自动调用）。

### 原则 5：harness 可被 agent 维护
**msgcode 对齐度：🟡 有意识未做。** skill 说明书可以由 AI 提议更新（AGENTS.md: "先改提示词/合同/说明书"），但没有机制化。

---

## 三、msgcode 的有意取舍（文档批评但 msgcode 认为正确的）

| 文档主张 | msgcode 反向选择 | 理由 |
|---|---|---|
| 把规范编译成机械约束 | 用 SKILL.md 语义约束代替硬编码拦截 | "做薄""服务 LLM 不抢决策权" |
| 加独立 critic agent | 不加审查层 | "禁止新增裁判层" |
| 分层知识访问系统 | skill index + SKILL.md 两级索引 | 够用就行 |
| 自动选择验证器 | 留给 LLM 自己判断 | "AI 是唯一主执行者" |

> [!IMPORTANT]
> 这些取舍整体上是自洽的——msgcode 的核心信条是 **"系统做薄，能力暴露给 LLM，不替 LLM 做主"**。这和文档的 "Big Harness" 思路有根本分歧。但文档自己也说了："不要赌单边"——模型够强时 harness 可以薄，模型不够强时 harness 要补。msgcode 目前赌的是模型足够强。

---

## 四、值得关注的缺口（按投入产出比排序）

1. **自动验证闭环** — 子代理完成后自动跑 `lint/test/build` 验证产出，不通过就不标 `pss`。成本低、收益高，且不违反"做薄"原则（只是暴露了一个验证工具，还是由 LLM 决定用不用）。

2. **持久化失败轨迹** — 当前 `lastErrorCode` 只存最后一个，历史失败模式都丢了。写个 `failures.jsonl` 就行。

3. **drift detection 闭环** — [work-continuity.ts](file:///Users/admin/GitProjects/msgcode/src/runtime/work-continuity.ts) 有 [detectDrift()](file:///Users/admin/GitProjects/msgcode/src/runtime/work-continuity.ts#643-717) 但 drift 报告只是信息性的，没人消费。可以在 heartbeat tick 里给 LLM 提供 drift 摘要。

4. **循环检测中间层** — 当前只有计数硬切。可以在触顶前给 LLM 附加一段 "你已经第 N 次用相同工具相同参数了，请换个思路" 的提示，成本几乎为零。
