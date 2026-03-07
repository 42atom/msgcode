# 当前提示词抽离清单（供后续调整）

## 结论

当前影响 `msgcode` 智能体行为的提示词，不只一处。  
真正生效的是“**文件提示词 + 代码硬约束 + 路由分类提示词 + 工具说明书**”四层叠加。

如果你后续要调“会不会主动用工具 / 会不会用 browser / 输出风格”，优先看下面 4 处。

## 1. 主系统提示词文件

**文件**：`prompts/agents-prompt.md`

**加载优先级**：
1. `AGENT_SYSTEM_PROMPT`
2. `AGENT_SYSTEM_PROMPT_FILE`
3. 默认文件：`prompts/agents-prompt.md`

**当前作用**：
- 定义智能体总体角色
- 定义“Tools before text / Read before edit / Verify before deliver”
- 定义默认输出风格
- 定义 SOUL、记忆、CLI 使用规则

**最值得你直接改的段落**：
- `核心口令（硬规则）`
- `执行总则`
- `CLI 使用规则`
- `输出规则`

## 2. 代码硬约束（会自动拼接到系统提示后面）

**文件**：`src/agent-backend/prompt.ts`

### A. 对话链路附加约束

常量：`QUICK_ANSWER_CONSTRAINT`

作用：
- 强制“先工具后文本”
- 强制“改前先读”
- 强制“交付前验证”
- 控制输出不要空谈

### B. 执行链路附加约束

常量：`EXEC_TOOL_PROTOCOL_CONSTRAINT`

作用：
- 强制执行核第一轮优先产出 `tool_calls`
- 明确网页/新闻/实时信息/浏览器操作必须先发工具调用
- 禁止没拿到工具结果就直接下结论

这是当前“让模型先调工具而不是直接聊”的核心硬约束之一。

### C. MCP 防循环约束

常量：`MCP_ANTI_LOOP_RULES`

作用：
- 防止 filesystem/MCP 工具重复调用
- 限制同路径 listing 和总调用次数

## 3. 路由分类提示词

**文件**：`src/agent-backend/routed-chat.ts`

常量：`ROUTE_CLASSIFIER_SYSTEM_PROMPT`

作用：
- 决定一条请求走 `no-tool / tool / complex-tool`
- 这会直接影响后面是否进入 tool-loop

当前规则重点：
- 纯问答/闲聊/解释 = `no-tool`
- 需要真实环境读取/执行 = `tool`
- 多步骤且需要工具 = `complex-tool`

如果后续你想调“哪些请求更容易进 tool 路由”，这里是关键入口。

## 4. 工具说明书（不是自然语言提示词，但会直接影响模型决策）

**文件**：`src/tools/manifest.ts`

作用：
- 决定模型能看到哪些工具
- 决定每个工具的 `description`
- 决定每个工具的参数 schema

这层会强烈影响模型是否理解 `browser`、`bash`、`read_file` 等工具该怎么用。

如果你想提升 browser 工具命中率，但又**不想做自然语言强绑定**，这里是最稳的调节点：
- 优化 `browser.description`
- 优化 `browser.parameters`

## 当前建议的调词顺序

1. 先改 `prompts/agents-prompt.md`
   - 调整体风格和工具使用倾向
2. 再改 `src/agent-backend/prompt.ts`
   - 调执行核硬约束
3. 如需调“进不进 tool 路由”，改 `src/agent-backend/routed-chat.ts`
4. 如需调“模型怎么理解 browser 工具”，改 `src/tools/manifest.ts`

## 一句话定位

- 想调“人格/行为风格”：改 `prompts/agents-prompt.md`
- 想调“先不先用工具”：改 `src/agent-backend/prompt.ts`
- 想调“要不要进 tool 路由”：改 `src/agent-backend/routed-chat.ts`
- 想调“browser 工具描述是否更清楚”：改 `src/tools/manifest.ts`
