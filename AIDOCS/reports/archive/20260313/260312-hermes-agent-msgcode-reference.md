# Hermes Agent 对 msgcode 的参考分析

日期：2026-03-12

## 结论

- `hermes-agent` 最值得借鉴的，不是它“大而全”的 agent 平台形态，而是它把 `skills` 当成能力说明书、把 `context files` 当成显式输入、把 `memory/session recall` 当成真实文件/数据库事实源来服务模型。
- `msgcode` 当前主线在“做薄、skill-first、单真相源”上其实比 Hermes 更克制；不应该因为 Hermes 功能多，就把 `msgcode` 往“统一控制面/统一 agent 平台”方向带偏。
- 对 `msgcode` 的最小可删落地建议只有三条：
  1. 补一个更强的 runtime skill 索引注入层，让模型按“类别 + 描述 + 条件”发现 skill，而不是只靠主提示词硬编码提醒。
  2. 补一个 `AGENTS.md / SOUL.md / 关键上下文文件` 的安全扫描与截断装配层，防止脏上下文直接注入系统提示。
  3. 若后续确认有真实痛点，再补“跨会话 session recall”能力；先做成可选 skill，不要先做进主链控制面。

## Hermes 到底是什么

### 1. 主链是一个单进程大 Agent

- 主入口是 `run_agent.py`，文件接近 5k 行，自己负责系统提示词拼装、工具循环、上下文压缩、memory flush、skill nudge、delegation、trajectory 保存等多项职责。
- 证据：
  - Code: `/Users/admin/GitProjects/GithubDown/hermes-agent/run_agent.py`
  - `AIAgent` 定义与初始化：`run_agent.py:187`
  - 系统提示词组装：`run_agent.py:1408`

### 2. skill 是一等公民，不是附件

- 它会扫描 `~/.hermes/skills/` 下所有 `SKILL.md`，抽取 `description`，按分类生成一个紧凑 skill index 注入 system prompt。
- 还支持按工具/工具集做条件展示，避免模型看到当前不可用或不该优先用的 skill。
- 证据：
  - Code: `/Users/admin/GitProjects/GithubDown/hermes-agent/agent/prompt_builder.py`
  - 技能索引生成：`agent/prompt_builder.py:238`
  - 条件隐藏逻辑：`agent/prompt_builder.py:190`
  - slash command 扫描：`agent/skill_commands.py:16`

### 3. context file 也是正式输入

- Hermes 会自动加载工作区里的 `AGENTS.md`、`.cursorrules`、`.cursor/rules/*.mdc`、`SOUL.md`，统一拼到 system prompt 里。
- 它不是无脑拼接，先做 prompt injection / 隐形字符 / secrets exfiltration 风险扫描，再做截断。
- 证据：
  - Code: `/Users/admin/GitProjects/GithubDown/hermes-agent/agent/prompt_builder.py`
  - 扫描规则：`agent/prompt_builder.py:20`
  - context file 装配：`agent/prompt_builder.py:350`

### 4. memory 和 session recall 是真能力，不是口号

- session 历史用 SQLite + FTS5 存，支持跨 session 搜索和摘要召回。
- memory 用文件存，但采用“冻结快照注入 system prompt + 运行中实时写盘”的模式，避免每次写记忆都打碎 prefix cache。
- 证据：
  - Code: `/Users/admin/GitProjects/GithubDown/hermes-agent/hermes_state.py`
  - SQLite + FTS5：`hermes_state.py:5`, `hermes_state.py:73`
  - Code: `/Users/admin/GitProjects/GithubDown/hermes-agent/tools/memory_tool.py`
  - 冻结快照设计：`tools/memory_tool.py:11`, `tools/memory_tool.py:87`
  - session_search schema：`tools/session_search_tool.py:345`

### 5. 工具层做了较多平台化

- Hermes 有完整 toolset system、registry discovery、delegation、code execution、cron、gateway、多消息平台、approval、RL/trajectory 等。
- 这让它更像一个“agent operating environment”，而不只是一个薄执行链。
- 证据：
  - Code: `/Users/admin/GitProjects/GithubDown/hermes-agent/toolsets.py`
  - Code: `/Users/admin/GitProjects/GithubDown/hermes-agent/model_tools.py`
  - Code: `/Users/admin/GitProjects/GithubDown/hermes-agent/tools/delegate_tool.py`
  - Code: `/Users/admin/GitProjects/GithubDown/hermes-agent/tools/approval.py`

## 对 msgcode 真有价值的部分

### 1. skill 索引注入方式，值得学

Hermes 的高价值点不是“skill 很多”，而是它让模型在每轮之前都能看到一个压缩过的能力目录，并且目录是按语义描述组织的，不只是 skill 名字堆列表。

这点对 `msgcode` 很对路，因为 `msgcode` 已经有明确的 runtime skill 单真相源：

- `src/skills/runtime/index.json:1`
- `src/skills/README.md:5`
- `prompts/agents-prompt.md:5`

当前 `msgcode` 已经要求模型“先读 index.json，再读对应 SKILL.md”，方向是对的；但主提示词仍然偏人工手写硬编码，技能发现体验还不如 Hermes 自动。

最小借鉴方式：

- 保留 `src/skills/runtime/index.json` 作为真相源，不新增 registry。
- 在 prompt 组装时，把 `index.json` 渲染成一个紧凑的“可用技能目录块”。
- 后续如果需要，再给 skill entry 增加极少量条件字段，比如：
  - `requires_tools`
  - `requires_channel`
  - `fallback_for`

### 2. context file 安全扫描，值得学

`msgcode` 现在会读取 base prompt，也会按需注入 SOUL 和上下文，但缺少 Hermes 那种统一的“扫描 + 截断 + 装配”入口。

现状证据：

- `src/agent-backend/prompt.ts:131`
- `src/runtime/context-policy.ts:210`
- `prompts/agents-prompt.md:13`

Hermes 的做法值得最小借鉴：

- 读取前先扫隐形字符、明显 prompt injection、secret exfiltration 模式。
- 对超长上下文做 head/tail 截断，而不是整段塞进 prompt。
- 把这层收口到一个 helper，不扩散到各个调用点。

这符合 `msgcode` 的“单一主链 + 薄 helper”原则。

### 3. memory 的“冻结快照”设计，值得参考

`msgcode` 现在的 memory 更像“检索式证据注入”：

- SQLite + FTS5 + sqlite-vec：`src/memory/store.ts:1`
- listener 注入记忆块：`src/listener.ts:371`

这条链本身没问题，而且比 Hermes 更贴近“代码/文档检索”。但如果以后 `msgcode` 要引入“用户偏好/工作区长期约束/稳定操作习惯”这类小而稳定的长期记忆，Hermes 的冻结快照思路是对的：

- 会话开始时固定快照，减少 system prompt 抖动。
- 会话中写入磁盘，但不强刷回当前 prompt。
- 下一次会话再生效。

这能避免为了“实时更新记忆”把主链搞复杂。

### 4. session recall 是有启发的，但只能后置

Hermes 有跨 session 的 recall：

- `hermes_state.py:35`
- `tools/session_search_tool.py:348`

`msgcode` 目前主要是：

- 会话窗口：`src/runtime/context-policy.ts:221`
- 规则式摘要：`src/summary.ts:1`
- 工作区 memory 搜索：`src/listener.ts:371`

这已经覆盖了“当前任务”和“工作区知识”两层，但还没有“过往对话历史 recall”。如果以后用户频繁说“上次我们怎么修的”“前两天定过什么口径”，session recall 可以考虑补。

但建议方式是：

- 先做一个可选 skill 或 CLI 子命令。
- 明确只查 `msgcode` 自己的 session 真相源。
- 先服务检索，不引入自动 memory flush / 自动 user modeling / Honcho。

## 明确不建议照搬的部分

### 1. 不要抄它的大一统平台形态

Hermes 的优势也是它的重量：

- `run_agent.py` 过大。
- gateway、cron、toolsets、approval、delegation、trajectory、RL、multi-platform 都挂在一棵树上。

这对 Hermes 成立，不代表对 `msgcode` 成立。`msgcode` 当前已经明确反对“为了更完整而加控制面/编排层”，这里不该反向走回去。

相关对照：

- Hermes 大主链：`/Users/admin/GitProjects/GithubDown/hermes-agent/run_agent.py`
- msgcode 薄主链约束：`/Users/admin/GitProjects/msgcode/src/runtime/context-policy.ts:1`
- msgcode skill 单真相源：`/Users/admin/GitProjects/msgcode/src/skills/README.md:5`

### 2. 不要抄它的“自动自学习闭环”

Hermes 会周期性提醒模型去写 memory、写 skill：

- memory nudge：`run_agent.py:3253`
- skill nudge：`run_agent.py:3266`

这在研究型 agent 里合理，但对 `msgcode` 当前阶段风险偏高：

- 容易把“应该写什么”变成模型自作主张。
- 容易把 skill 目录变成持续漂移的半自动产物。
- 容易引入更多审计、冲突处理、回滚、权限问题。

对 `msgcode` 来说，更合适的是：

- 继续坚持“先把说明书写好，再谈自动产 skill”。
- skill 修改默认仍由仓库和明确任务驱动。

### 3. 不要抄它的 delegation / subagent 体系

Hermes 的 subagent 设计是完整的，但代价也高：

- 新的隔离上下文
- 新的 toolset 过滤
- 新的预算共享
- 新的结果摘要协议

证据：

- `tools/delegate_tool.py:5`
- `tools/delegate_tool.py:31`
- `tools/delegate_tool.py:562`

`msgcode` 现在主问题并不是“缺 subagent”，而是“让主链更稳、更直、更少猜”。现阶段引入 subagent 基本不是 MVP。

### 4. 不要抄它的审批/安全控制面

Hermes 的 `tools/approval.py` 做的是全局危险命令审批：

- 检测模式：`tools/approval.py:23`
- 会话审批状态：`tools/approval.py:75`

如果 `msgcode` 直接抄，会很容易又长出一层“前置裁判层”。在你的仓库原则里，这类层只有在主链上已经出现可复现失败时才值得加。

现在更好的方向仍然是：

- 先通过 prompt/skill 合同约束真实调用。
- 先通过证据/日志暴露风险。
- 不先上一个新的审批平台。

## 对 msgcode 的建议方案

### MVP：只做三件事

1. runtime skill index prompt 化

- 输入仍然只认 `src/skills/runtime/index.json`
- 在 `src/agent-backend/prompt.ts` 或 `src/runtime/context-policy.ts` 附近增加一个只读 helper，把 skill 索引渲染成紧凑文本块
- 不新增 registry，不新增 orchestration，不新增自动 patch

2. context file guard

- 新增一个最薄 helper，统一读取并扫描：
  - `<workspace>/.msgcode/SOUL.md`
  - 如后续需要，再扩到 workspace 级 `AGENTS.md`
- 扫描项先只做最明显几类：
  - prompt injection
  - hidden unicode
  - secret exfiltration
- 超长内容统一截断

3. session recall 只做预研，不先并主链

- 先确认是否真有“跨对话回忆缺口”
- 如果缺口成立，先做 skill/CLI 原型
- 不先加自动 nudge / 自动 flush / 自动画像

### 扩展版：等 MVP 被证明有价值后再看

- 给 runtime skill entry 增加条件字段
- 给 optional skills 做更好的分类发现
- 增加“基于 session 文件的 recall”能力

## Occam Check

### 不加这些，系统具体坏在哪

- 不补 skill index prompt 化：模型仍可能知道“要先读 skill”，但技能发现成本偏高，尤其是 skill 数量继续增长时。
- 不补 context file guard：工作区上下文一旦混入脏指令或超长内容，会直接污染 prompt，风险真实存在。
- 不补 session recall：当前不会立刻坏，只是在“跨会话复盘”场景下能力偏弱，所以它只能排在第三优先级。

### 用更少的层能不能解决

- 能。三个建议都可以做成只读 helper 或可选 skill。
- 不需要新增 manager、control plane、approval center、agent hub。

### 这个改动让主链数量变多了还是变少了

- skill index prompt 化：不增加主链，只增强现有 prompt 主链。
- context file guard：不增加主链，只给现有 prompt 输入加统一入口。
- session recall：若做成 optional skill，不增加主链；若做进 core，才会开始变重。

## 一句话判断

Hermes 应该当“参考资料库”，不是“演进蓝图”。

对 `msgcode` 来说，应该学它的说明书设计、skill 发现、context guard、记忆快照这些薄层；不要学它把所有能力都往一个超级 agent 平台里收的冲动。

## 证据清单

- Docs: `/Users/admin/GitProjects/GithubDown/hermes-agent/README.md`
- Code: `/Users/admin/GitProjects/GithubDown/hermes-agent/run_agent.py`
- Code: `/Users/admin/GitProjects/GithubDown/hermes-agent/agent/prompt_builder.py`
- Code: `/Users/admin/GitProjects/GithubDown/hermes-agent/hermes_state.py`
- Code: `/Users/admin/GitProjects/GithubDown/hermes-agent/toolsets.py`
- Code: `/Users/admin/GitProjects/GithubDown/hermes-agent/model_tools.py`
- Code: `/Users/admin/GitProjects/GithubDown/hermes-agent/tools/memory_tool.py`
- Code: `/Users/admin/GitProjects/GithubDown/hermes-agent/tools/session_search_tool.py`
- Code: `/Users/admin/GitProjects/GithubDown/hermes-agent/tools/delegate_tool.py`
- Code: `/Users/admin/GitProjects/GithubDown/hermes-agent/tools/approval.py`
- Code: `/Users/admin/GitProjects/msgcode/prompts/agents-prompt.md`
- Code: `/Users/admin/GitProjects/msgcode/src/skills/runtime/index.json`
- Code: `/Users/admin/GitProjects/msgcode/src/skills/README.md`
- Code: `/Users/admin/GitProjects/msgcode/src/agent-backend/prompt.ts`
- Code: `/Users/admin/GitProjects/msgcode/src/runtime/context-policy.ts`
- Code: `/Users/admin/GitProjects/msgcode/src/memory/store.ts`
- Code: `/Users/admin/GitProjects/msgcode/src/listener.ts`
- Code: `/Users/admin/GitProjects/msgcode/src/summary.ts`
