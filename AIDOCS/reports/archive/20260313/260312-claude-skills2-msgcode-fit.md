# Claude Skills 2.0 文章对 msgcode 的适配判断

日期：2026-03-12

## 结论

- 需要吸纳，但只吸“skill 发现与分层加载”这部分，不吸“围绕设计师工作流扩一圈新平台”的那部分。
- 这篇 UX Planet 文章里真正有价值的，不是“给产品设计师做 skill”，而是它背后的 Anthropic skill 方法论：
  - 渐进披露
  - frontmatter 驱动触发
  - skill 之间可组合
  - skill 是知识层，不是控制层
- `msgcode` 其实已经走在这条路上，但还差两步：
  1. 把运行时 skill 索引渲染成给模型看的紧凑目录块
  2. 让 runtime skill 的 frontmatter/description 更系统地承担“何时使用”的触发职责

## 这篇文章到底在说什么

- 文章标题是 “Claude Skills 2.0 for Product Designers”，发布时间显示为 2026 年 3 月，作者把 Anthropic 最近的改进称作 “Skills 2.0”，但这更像作者包装，不是我看到的 Anthropic 官方产品命名。
- 可见正文里明确说：
  - skill 是 Claude 的可复用能力或工作流
  - skill 本体是带 YAML frontmatter 的 Markdown 文件
- 证据：
  - Article: [UX Planet 文章](https://uxplanet.org/claude-skills-2-0-for-product-designers-a86f4518b3ba)
  - 可见内容：`What is Claude Skill`、`The skill itself is a markdown file (.md) file`

## 官方侧真正值得看的点

Anthropic 官方 PDF《The Complete Guide to Building Skill for Claude》给出的核心原则，比文章标题本身更重要。

### 1. Progressive Disclosure

- skill 有三层：
  - frontmatter：永远在 system prompt 里，负责让模型知道何时该用
  - `SKILL.md` 正文：只有相关时才加载
  - `references/` 等附属文件：按需再读
- 这正是 skill-first 系统最该学的地方，因为它在“能力发现”和“上下文成本”之间做了收口。
- 证据：
  - Source: [Anthropic PDF](https://resources.anthropic.com/hubfs/The-Complete-Guide-to-Building-Skill-for-Claude.pdf)
  - `First level (YAML frontmatter): Always loaded in Claude's system prompt`
  - `Second level (SKILL.md body): Loaded when Claude thinks the skill is relevant`
  - `Third level (Linked files): ... discover only as needed`

### 2. Description 必须同时回答 “做什么 + 何时用”

- 官方文档明确要求 description 里必须同时包含：
  - What it does
  - When to use it
- 这不是文案美化，而是 skill 自动触发的核心。
- 证据：
  - Source: [Anthropic PDF](https://resources.anthropic.com/hubfs/The-Complete-Guide-to-Building-Skill-for-Claude.pdf)
  - `description (required): MUST include BOTH: What the skill does / When to use it`

### 3. Skill 是知识层，不是工具层替代物

- 官方文档把 MCP 比作厨房，把 skill 比作知识层。
- 这点和 `msgcode` 的主线高度一致：系统职责是暴露真实能力边界，不是替模型多加控制面。
- 证据：
  - Source: [Anthropic PDF](https://resources.anthropic.com/hubfs/The-Complete-Guide-to-Building-Skill-for-Claude.pdf)
  - `Skills are the knowledge layer on top`

### 4. Skill 应该可组合

- 官方文档明确说多个 skill 可以同时加载，单个 skill 不该假设自己是唯一能力。
- 这意味着 skill 文案要写边界，不要写成“我接管一切”的总控说明书。
- 证据：
  - Source: [Anthropic PDF](https://resources.anthropic.com/hubfs/The-Complete-Guide-to-Building-Skill-for-Claude.pdf)
  - `Claude can load multiple skills simultaneously`

## 对 msgcode 有价值的结合点

### 1. 吸纳 “frontmatter 真正承担触发职责”

`msgcode` 现在已经把 skill 作为正式真相源，并强调：

- runtime skills 是唯一正式常驻真相源
- skill 更像 API 文档，不像流程编排器

证据：

- Code: `/Users/admin/GitProjects/msgcode/src/skills/README.md`
- Code: `/Users/admin/GitProjects/msgcode/src/skills/runtime/index.json`

但目前的触发职责，仍然比较依赖主 prompt 的人工提醒：

- `必须先读 index.json，再读对应 SKILL.md`
- “常见基础 skill 包括 ...”

证据：

- Code: `/Users/admin/GitProjects/msgcode/prompts/agents-prompt.md`

建议吸纳的不是“再写更多主 prompt”，而是：

- 统一梳理 runtime skill 的 frontmatter
- 强制每个 skill 的 `description` 都具备：
  - 能力描述
  - 触发条件
  - 常见用户说法

这样模型未来看到的 skill index 才会更像 Anthropic 的第一层 progressive disclosure。

### 2. 吸纳 “skill index 紧凑渲染”

`msgcode` 当前正式索引来自运行时技能目录同步链：

- repo 真相源：`src/skills/runtime/`
- 同步器：`src/skills/runtime-sync.ts`
- 运行时索引：`~/.config/msgcode/skills/index.json`

其中同步器还会把 optional skill 合并进运行时主索引，只是标记 layer。

证据：

- Code: `/Users/admin/GitProjects/msgcode/src/skills/runtime-sync.ts`

这意味着 `msgcode` 已经具备做 Anthropic 那种第一层索引的结构基础。现在缺的只是：

- 一个 `renderLlmSkillIndex()` helper
- 在 dialog / exec 两条链都注入

这是最值得吸收的地方。

### 3. 吸纳 “详细说明搬到 references，正文保持聚焦”

Anthropic 官方建议把细节下沉到 `references/`，避免正文过厚。

`msgcode` 现在部分 skill 已经这么做了，比如：

- `banana-pro-image-gen`
- `local-vision-lmstudio`

证据：

- Code: `/Users/admin/GitProjects/msgcode/src/skills/runtime/banana-pro-image-gen/`
- Code: `/Users/admin/GitProjects/msgcode/src/skills/runtime/local-vision-lmstudio/`

这条值得继续强化，尤其适合：

- 浏览器 skill
- 视觉 skill
- 多步骤生成类 skill

## 不建议吸收的部分

### 1. 不要吸 “为设计师单独长一套 skill 控制层”

这篇文章的应用场景偏产品设计，里面会天然鼓励做更多特化 workflow。

对 `msgcode` 来说，风险是：

- 容易把 skill 从“能力说明书”变成“行业工作流平台”
- 容易让 skill 文案替模型过度做主

这和你的主线是冲突的。

### 2. 不要吸 “让 skill 取代真实工具合同”

文章场景容易把 skill 写成长提示词模板。

`msgcode` 不该这么走。你的 skill 必须继续服务真实 CLI / 真实工具，而不是用一堆 prompt trick 把工具边界糊掉。

### 3. 不要吸 “为了自动触发而写模糊 description”

官方其实反过来强调 description 要具体、有 trigger phrase。

如果为了“更容易被触发”而把 description 写成泛能力，例如：

- 帮助做设计
- 帮助处理文档
- 处理多媒体任务

那会直接把 skill 发现搞坏。

## 我对是否吸纳的明确判断

### 应该立刻吸纳

1. skill frontmatter/description 规范化
2. 运行时 skill index 的 prompt 渲染
3. 正文更薄、细节下沉到 `references/`

### 可以后续吸纳

1. skill pack / 分类展示
2. 更明确的条件加载字段

### 不该吸纳

1. 围绕某一职业场景再长一层 skill 平台
2. 把 skill 当成替模型做主的工作流控制器
3. 用更长主 prompt 去替代更好 frontmatter

## 一句话决策

需要吸纳，但吸的是 Anthropic skill 方法论，不是这篇文章的职业场景包装。

对 `msgcode` 最有价值的落点，就是把现有 runtime skill 体系往 “progressive disclosure + triggerable description + compact index injection” 再推进半步。

## 证据

- Source: [UX Planet 文章](https://uxplanet.org/claude-skills-2-0-for-product-designers-a86f4518b3ba)
- Source: [Anthropic 官方技能指南 PDF](https://resources.anthropic.com/hubfs/The-Complete-Guide-to-Building-Skill-for-Claude.pdf)
- Source: [Claude Code Memory 文档](https://code.claude.com/docs/zh-CN/memory)
- Code: `/Users/admin/GitProjects/msgcode/src/skills/README.md`
- Code: `/Users/admin/GitProjects/msgcode/src/skills/runtime/index.json`
- Code: `/Users/admin/GitProjects/msgcode/src/skills/runtime-sync.ts`
- Code: `/Users/admin/GitProjects/msgcode/prompts/agents-prompt.md`
