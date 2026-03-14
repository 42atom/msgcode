# 关于“给 LLM 设计厚重 CLI 外壳”的架构会诊

你感觉到的“不太对劲”拥有极度敏锐的直觉，这完全中了你自己在 [AGENTS.md](file:///Users/admin/GitProjects/msgcode/AGENTS.md) 里定下的架构大忌。

作为资深架构师，你一定懂这句 Unix 箴言：“**提供机制，不要提供策略**”。你设计的这些 CLI（如 `msgcode file read`、`msgcode file move`、`msgcode system info` 等），本质上是你在为 LLM **包办策略**，而不是在**暴露机制**。

下面我从你的架构原则出发，帮你把这股“不对劲”的具体病因理一理：

### 1. 严重违背了“做薄”与“不加层”原则 (Anti-Thinness)
**病理**：你用 Node.js 的 `commander` 写了一整套巨构化的 CLI（[src/cli/file.ts](file:///Users/admin/GitProjects/msgcode/src/cli/file.ts)、[src/cli/system.ts](file:///Users/admin/GitProjects/msgcode/src/cli/system.ts)...），里面包含了各种参数解析、错误捕获、JSON Envelope 封装。
**真相**：LLM 已经是地表最强的 Shell/Bash 操作员。它完全可以直接执行 `cat`、`ls`、`find`、[rm](file:///Users/admin/GitProjects/msgcode/src/cli.ts#74-99)、`grep`。你花大力气用 TypeScript 重新发明了 Unix 核心工具包的核心子集，在真实的操作系统与 LLM 之间硬塞入了一个厚重中间件。

### 2. 剥夺了“原生工具的第一公民”地位 (Wrapper Anti-pattern)
**病理**：在 [AGENTS.md](file:///Users/admin/GitProjects/msgcode/AGENTS.md) 里你写道：*“`msgcode` 二进制与原生工具是第一公民能力边界… 不要再在外面包一层 alias wrapper 来抢走它的价值。”*
**真相**：你为了让 LLM “更好”地消费，把原生的 `cat` 变成了 `msgcode file read`。一旦这个 CLI 抛错，LLM 看到的不再是原汁原味的、全网语料里见得最多的物理机级 bash 报错，而是你人造的 `{"errorCode": "FILE_READ_NOT_FOUND"}` 包裹。这不仅没帮到模型，反而削弱了模型凭借原生常识进行排障（troubleshooting）的能力。

### 3. 本末倒置：为了写 Skill 而造 CLI
**病理**：*“采用 skill 做指引”*。现在的设计似乎变成了：为了在 `skills/` 里放一个 Markdown 说明书，就必须先造一个 `msgcode xxx` 的子命令来给它挂靠。
**真相**：Skill 的本质是“说明书”，不是“控制器”。如果能力已经存在（比如系统自带了文件系统能力），你的 Skill 只需要教它怎么用（即：“随时使用原生的 bash 命令”），而不是非得提供一个自己造的 CLI 工具去教它用。造这些命令就是“在替模型发明 wrapper、拼装层”。

### 4. 违背 Unix 哲学：用 Monolith 替代 Composability
**病理**：`msgcode` 正在变成一个大泥球（Monolith），塞进了从文件读写到浏览器控制、到媒体处理、再到系统诊断的所有逻辑。
**真相**：Unix 的精髓是组合优于叠层。小工具通过标准输入输出串联。LLM 可以完美组合管道（`find . -name "*.ts" | xargs grep "foo"`），但它很难去组合那些封装死的、返回定制 JSON 格式的 `msgcode file find` 命令。

---

### 架构修正方向（"做薄"的处方）

既然我们走的是**“不剥夺执行权”、“真实下限”的底层路线**，你应该：

1. **大砍刀：删掉冗余 CLI**
   诸如 `msgcode file *`、`msgcode thread *`（如果是纯本地文件操作）、`msgcode system *` 等，能直接用原生 bash 替代的，全部删掉。
2. **退回真实物理边界**
   如果某个能力是第三方 SaaS（比如 Feishu 发送、Banana 图片生成、或需要调用特定浏览器的无头行为），这种可以保留为 `CLI` 或者纯粹暴露一个 `curl`/`python script`，这属于“把能力拉过桥”。
3. **Skill = 纯文案契约**
   如果 LLM 需要处理文件，就在 `system prompt` 或一个统一的 `local-fs` skill 里写上一句：*“你可以自由并直接使用系统原生的 bash、sed、grep、jq 等命令，不要期待有任何封装层。”* 完事。

你对这种“脱裤子放屁”的设计感到不安是非常准确的。**做薄的意思是，既然坐在 Unix 的地基上，就让大模型直接手摸泥土，别给它戴塑料手套。**

你怎么看？是否准备动手拆掉这些多余的面包壳？
