# msgcode 瘦身评审改写稿（给 GEMINI 评审）

## 结论

这份 review 的大方向是对的：`msgcode` 目前仍然存在明显的过度设计痕迹，尤其集中在执行热路径、工具总线、CLI 命令面和部分系统代答逻辑上。

但原稿有一个关键问题：它把两类东西混在了一起：

1. **应该尽快删除的“重复包装层”**
2. **当前仍承担真实产品边界的“运行时主链能力”**

如果不区分这两类，按原稿直接推进，会把“做薄”误执行成“把系统掏空”。

因此，本评审建议不是 `go`，也不是 `hold`，而是：

- **Recommendation: pivot**
- **Confidence: high**
- **Scope: 先删二手壳与代决层，再逐项审查仍在主链上的状态层/调度层/任务层，禁止口号式清仓**

---

## 一、哪些判断成立，应该直接吸收

### 1. `tool-loop` 仍然过厚，热路径中混入了太多解释性和补救性逻辑

这点成立，而且是当前最值钱的瘦身入口。

代码证据：

- `/Users/admin/GitProjects/msgcode/src/agent-backend/tool-loop.ts`：1701 行
- 文件内仍可检索到：
  - `recoveryNudges`
  - `quotaProfile`
  - 配额命中后的 continuable 构造
  - 面向模型的错误引导文案

这说明当前热路径还没有完全收口成：

`模型 -> 工具 -> 结果 -> 模型`

而仍然存在：

`模型 -> tool-loop 决策/补救/裁剪/提示 -> 工具 -> 再解释 -> 模型`

### 2. Tool Bus 仍然太厚，不够像“薄 RPC 网关”

这点也成立。

代码证据：

- `/Users/admin/GitProjects/msgcode/src/tools/bus.ts`：2325 行

一个真正做薄的工具层，更接近：

1. 参数校验
2. 调真实函数或外部能力
3. 原样返回结果

而不是继续在总线里承载太多预览加工、上下文 fallback、错误美化和能力策略。

### 3. 继续退役二手 CLI 壳，方向完全正确

这点已经在近期落地，说明 review 的判断与仓库主线一致。

现有已完成收口：

- `/Users/admin/GitProjects/msgcode/issues/tk0142.dne.tools.retire-file-system-cli-wrappers.md`
- `/Users/admin/GitProjects/msgcode/issues/tk0143.dne.tools.retire-system-info-auto-skill.md`
- `/Users/admin/GitProjects/msgcode/issues/tk0144.dne.tools.retire-web-cli-wrappers.md`

这些 issue 已明确：

- `file/system/web` 这类不跨新边界的壳应该退役
- 本地文件与系统壳操作默认交回原生工具或 `bash`
- 仓库不再维护“二手 Unix / 二手上游能力”的常驻合同

### 4. “错误优先原样回给 LLM，说明书负责教下一步”是正确路线

这不是新观点，而是已经冻结过的仓库级硬约束。

文档证据：

- `/Users/admin/GitProjects/msgcode/docs/plan/pl0102.dne.runtime.llm-execution-authority-charter.md`

该宪章已经明确：

- AI 是唯一主执行者
- 系统只保留三类硬边界：安全、预算、物理
- 默认把工具执行结果忠实回给模型
- 不新增“为了更可控”而存在的前置裁判层、finish supervisor 代决层、规则化系统代答、猜测式 fallback

换句话说，review 在理念上是对的，但仓库其实已经接受了这套原则；现在需要的是**继续执行，不是重新喊口号**。

---

## 二、哪些判断需要改写，不能直接照单执行

### 1. “`schedule/jobs` 看起来像伪 App 逻辑，所以应该整体退回 cron/launchd”

这个判断过度简化了当前边界，不能直接执行。

原因不是“schedule 很高级”，而是它现在承担了真实的产品边界：

- workspace 级 schedule 真相源
- chat route / delivery 语义
- 与当前消息通道的绑定关系
- jobs 投影与运行记录

证据：

- `/Users/admin/GitProjects/msgcode/src/routes/cmd-schedule.ts`
- `/Users/admin/GitProjects/msgcode/src/jobs/scheduler.ts`
- `/Users/admin/GitProjects/msgcode/src/jobs/runner.ts`
- `/Users/admin/GitProjects/msgcode/docs/plan/pl0022.dne.tools.scheduler-skill-bash-mainline.md`

`0022` 已经证明一个关键事实：

- 这里不是在造假 `cron_add` 工具
- 而是在把“自然语言调度请求”收口到一条真实主链：
  - `scheduler skill -> bash -> msgcode schedule / workspace schedule 文件协议`

因此，这里的正确动作不是“整层删掉”，而是：

- **禁止继续平台化**
- **继续删二手入口**
- **保留当前确实承担产品边界的最小主链**

### 2. “memory 大多应删除，因为 LLM 已经有上下文”

这个判断也需要改写。

LLM 的上下文窗口不等于持久化记忆。问题不在于 `memory` 这个概念本身，而在于**当前实现复杂度可能高于主链收益**。

证据：

- `/Users/admin/GitProjects/msgcode/src/memory/store.ts`：649 行
- 仍包含：
  - `better-sqlite3`
  - `FTS5`
  - `sqlite-vec`
  - schema 初始化与向量路径

这说明真正该审的是：

1. memory 是否应该默认进入主链
2. 当前 SQLite + 向量 + 检索复杂度是否超过实际收益
3. 哪些能力可以退回 file-first / markdown-first

因此更准确的说法应该是：

- **memory 需要降级和收口**
- **不应继续默认膨胀**
- **优先 file-first，而不是先做价值判断说“memory 本身不该存在”**

### 3. “CLI 最终只应保留 `start/stop/probe`”

这个判断太绝对，不建议直接作为仓库级目标。

仓库自己的正式审计结论并不是“只能保留一个命令面”。

证据：

- `/Users/admin/GitProjects/msgcode/issues/tk0119.dne.tools.cli-reference-vs-runtime-gap-review.md`
- `/Users/admin/GitProjects/msgcode/docs/plan/pl0119.dne.tools.cli-reference-vs-runtime-gap-review.md`

`0119` 已经明确：

- 不教条式照搬单一 `run(command)`
- 不误伤已有价值的原生桥接能力
- 该删的是“工具存在但默认 suppress，再靠提示词映射另一条路”的认知折返

所以 CLI 的正确收口标准应是：

- **删除重复 Unix / 重复上游能力的壳**
- **保留 msgcode 自己真正跨边界的能力面**
- **继续减少“存在但不该默认用”的假正式入口**

---

## 三、哪些主张当前不应采纳

### 1. 不应把所有内部状态管理都定性为“非 Unix，因此应删”

Unix 哲学不是“拒绝状态”，而是：

- 优先单一真相源
- 优先文件和文本
- 优先可验证、可观测、可替换的边界

因此，真正该否决的是：

- 同一事实有多份状态真相源
- 状态仅存在于隐藏内存结构中
- 为补救前一层缺陷而增加另一层状态机

而不是简单地说“有状态就错”。

### 2. 不应把所有“用户可用能力”都退回纯 `bash`

`bash` 是基础能力，不是唯一能力。

对当前仓库来说，以下仍然属于真实桥接边界，而不是二手壳：

- browser
- feishu send/reply/react/list
- 任务委派 / subagent 运行时
- 通道绑定与 route 相关能力

如果这些也一律退回 `bash`，系统会从“做薄”走向“失去产品边界”。

---

## 四、建议采用的改写版本

### 改写后的总方针

不要再用“平台替 AI 做决定”的思路继续发展 `msgcode`。

但仓库级瘦身必须遵守一个更严格的判断标准：

> 先删“重复包装层”和“代决层”，再逐项审查仍在主链上的状态层、任务层、调度层是否真的跨了 Unix/LLM 无法稳定承担的边界。

### 建议路线

#### Phase 1：继续清理执行热路径里的代决逻辑

目标：

- 收口 `tool-loop`
- 删掉 recovery nudge、双重裁剪、模板化系统话术
- 让 quota 继续存在，但更像结构化事实，而不是系统代答

关联真相源：

- `/Users/admin/GitProjects/msgcode/issues/tk0121.dne.tools.help-tool-and-quota-hot-path-thinning.md`
- `/Users/admin/GitProjects/msgcode/issues/tk0126.dne.model.tool-loop-quota-hot-path-dedup.md`

#### Phase 2：继续把 Tool Bus 压成薄网关

目标：

- schema 校验
- 调真实能力
- 原样返回

禁止项：

- 不再在 bus 里继续堆策略判断
- 不再把错误“讲漂亮”
- 不新增补丁式 fallback

#### Phase 3：按“真实桥接 / 重复包装”标准继续收口 CLI 与工具面

保留：

- 真正跨边界的能力

退役：

- 重复 Unix
- 重复上游现成能力
- 仅为了“更可控”存在的包一层命令

#### Phase 4：逐个审查 `memory / schedule / task / jobs`

审查标准只有三个：

1. 不加它，系统具体坏在哪
2. 能否用更少的层解决
3. 它让主链数量变多了还是变少了

这一步的重点不是“先删”，而是**先证明**。

---

## 五、建议直接形成的评审结论

### Decision

- Recommendation: `pivot`
- Confidence: `high`
- Scope: `继续删热路径代决层与二手壳；对 memory/schedule/task/jobs 做逐项保留判定，不搞口号式大清仓`

### Why

1. 当前仓库确实存在明显的热路径臃肿与控制层外溢，尤其在 `tool-loop`、`Tool Bus`、CLI 二手壳上。
2. 原 review 对“系统不要替 LLM 做主”的判断是对的，并且已与仓库宪章一致。
3. 原 review 最大风险是把“重复包装层”和“真实产品边界”混为一谈，若直接执行，会误删当前仍承担真实交付语义的主链模块。

### Risks

1. 若继续只在口头层面认同 review，不把它改写成可执行边界，后续实现仍会滑回局部补丁。
2. 若把 `schedule/memory/task/jobs` 一刀切退回 `bash` 或系统级工具，会破坏现有产品边界与消息交付链路。
3. 若只做“删命令面”，不处理 `tool-loop` 和 `bus` 的代决逻辑，主链不会真正变直。

### Guardrails

- 前置条件：
  - 每一刀都必须先回答 Occam Check 三问
  - 先删重复壳，再碰主链边界
- 监控指标：
  - `tool-loop.ts` 行数与关键分支数量持续下降
  - `bus.ts` 职责收口为校验/执行/返回
  - `help-docs` / skill / prompt / CLI 合同口径保持一致
- 回滚条件：
  - 一旦某次瘦身导致真实交付边界断裂，只回滚该模块改动，不恢复已证明应退役的二手壳

### Next Actions

1. 基于本评审新开一张“热路径去代决层” issue，目标锁定 `tool-loop` 与 `Tool Bus`
2. 新开一张“memory 最小可删版本审计” issue，只做证据收集与 Occam Check，不先删库
3. 新开一张“schedule/jobs 边界重审” issue，区分真实交付语义与历史平台化残留

---

## 六、证据清单

### Docs

- `/Users/admin/GitProjects/msgcode/docs/plan/pl0102.dne.runtime.llm-execution-authority-charter.md`
- `/Users/admin/GitProjects/msgcode/issues/tk0119.dne.tools.cli-reference-vs-runtime-gap-review.md`
- `/Users/admin/GitProjects/msgcode/docs/plan/pl0119.dne.tools.cli-reference-vs-runtime-gap-review.md`
- `/Users/admin/GitProjects/msgcode/docs/plan/pl0022.dne.tools.scheduler-skill-bash-mainline.md`
- `/Users/admin/GitProjects/msgcode/issues/tk0142.dne.tools.retire-file-system-cli-wrappers.md`
- `/Users/admin/GitProjects/msgcode/issues/tk0143.dne.tools.retire-system-info-auto-skill.md`
- `/Users/admin/GitProjects/msgcode/issues/tk0144.dne.tools.retire-web-cli-wrappers.md`

### Code

- `/Users/admin/GitProjects/msgcode/src/agent-backend/tool-loop.ts`
- `/Users/admin/GitProjects/msgcode/src/tools/bus.ts`
- `/Users/admin/GitProjects/msgcode/src/cli.ts`
- `/Users/admin/GitProjects/msgcode/src/routes/cmd-schedule.ts`
- `/Users/admin/GitProjects/msgcode/src/jobs/scheduler.ts`
- `/Users/admin/GitProjects/msgcode/src/jobs/runner.ts`
- `/Users/admin/GitProjects/msgcode/src/memory/store.ts`

### Quick Facts

- `tool-loop.ts`: 1701 行
- `bus.ts`: 2325 行
- `cli.ts`: 707 行
- `task-supervisor.ts`: 755 行
- `jobs/scheduler.ts`: 512 行
- `memory/store.ts`: 649 行

---

## 七、给 Claude 的一句话摘要

这份原始 review 抓住了 `msgcode` 当前“热路径过厚、控制层外溢、二手壳过多”的核心问题，但需要从“全面清仓”改写成“先删重复包装层与代决层，再对仍在主链中的状态/调度/任务模块逐项做 Occam 审查”的版本，否则会误伤真实产品边界。
