## 

极简即强大

Pi是一个极简、可扩展的AI编码智能体框架（harness），其核心设计哲学可以用一句话概括：一个调用LLM的while循环，加上四个基础工具。与当今复杂的AI Agent平台不同，Pi选择了一条反其道而行的道路——不是增加更多功能，而是将复杂性降到最低。

开发者Armin Ronacher和Mario Zechner认为，现代顶尖大语言模型（如Claude Sonnet）已经具备足够的能力：它们擅长读取文件、编辑文件、执行命令。因此，Pi坚信： "Bash就是你所需要的一切" 。这个看似极端的理念背后，是对LLM能力的深度信任和对工具链复杂性的警惕。

让我们看看Pi的核心代码，理解什么是真正的"极简"。

## 

1\. 核心循环：一个while循环的真相

Pi的核心确实如开发者所说——就是一个while循环。在 packages/agent/src/agent-loop.ts 中：

```javascript
// 外层循环：处理后续消息队列 while (true) { let hasMoreToolCalls = true; let steeringAfterTools: AgentMessage[] | null = null; // 内层循环：处理工具调用和转向消息 while (hasMoreToolCalls || pendingMessages.length > 0) { // 1. 处理待处理消息（用户新输入或转向消息） if (pendingMessages.length > 0) { for (const message of pendingMessages) { currentContext.messages.push(message); } pendingMessages = []; } // 2. 调用LLM获取响应 const message = await streamAssistantResponse(currentContext, config, signal, stream); // 3. 检查是否有工具调用 const toolCalls = message.content.filter((c) => c.type === "toolCall"); hasMoreToolCalls = toolCalls.length > 0; // 4. 执行工具调用 if (hasMoreToolCalls) { const toolExecution = await executeToolCalls( currentContext.tools, message, signal, stream, config.getSteeringMessages ); // 工具结果会作为新消息加入上下文 for (const result of toolExecution.toolResults) { currentContext.messages.push(result); } } // 5. 检查转向消息（实时干预） pendingMessages = (await config.getSteeringMessages?.()) || []; } // 6. 检查后续消息队列 const followUpMessages = (await config.getFollowUpMessages?.()) || []; if (followUpMessages.length > 0) { pendingMessages = followUpMessages; continue; // 继续外层循环 } break; // 没有更多消息，结束 }
```

1.  把用户消息发给AI
    
2.  AI说"我要用工具" → 执行工具 → 把结果告诉AI
    
3.  AI继续思考，可能还要用工具 → 重复步骤2
    
4.  AI说"我完成了" → 检查有没有新用户消息 → 有就继续，没有就结束
    

这就是全部。 没有复杂的状态机，没有工作流引擎，没有递归调用——就是一个简单的"对话-执行-反馈"循环。

在 packages/coding-agent/src/core/tools/index.ts 中，Pi定义了四个核心工具：

```javascript
// 默认工具集：只有4个 export const codingTools: Tool[] = [readTool, bashTool, editTool, writeTool]; // 只读工具集（用于探索阶段） export const readOnlyTools: Tool[] = [readTool, grepTool, findTool, lsTool];
```

1.  read | 读取文件内容 | AI需要知道代码长什么样
    
2.  bash | 执行shell命令 | 运行git、npm、测试、grep、find等
    
3.  edit | 精确修改文件（查找替换） | 修改现有代码
    
4.  write | 写入新文件 | 创建新文件
    

Bash可以调用grep、find、ls、git、npm……整个Unix工具链都是AI的延伸。Pi的哲学是：不要为每个功能写新工具，让AI用Bash调用现有工具。

```typescript
const bashSchema = Type.Object({ command: Type.String({ description: "Bash command to execute" }), timeout: Type.Optional(Type.Number({ description: "Timeout in seconds" })), });
```

-   ✅ 工具设计遵循"Unix哲学"：每个工具做一件事，但可以组合
    
-   ✅ 优先使用系统已有能力，而非重新发明
    
-   ✅ 工具描述要清晰，让AI知道什么时候用什么
    

## 

3\. 自我扩展：技能系统如何工作

Pi的"元文档"约占总提示词的25%，教AI如何扩展自己。这是通过Skill系统实现的。

在 packages/coding-agent/src/core/skills.ts 中：

```javascript
export interface Skill { name: string; // 技能名称 description: string; // 技能描述（AI根据这个决定何时加载） filePath: string; // 技能文件路径 baseDir: string; // 技能根目录 source: string; // 来源（user/project/path） disableModelInvocation: boolean; // 是否禁用自动调用 } // 加载技能 export function loadSkills(options: LoadSkillsOptions = {}): LoadSkillsResult { // 从多个位置加载： // - ~/.pi/agent/skills/ (全局) // - .pi/skills/ (项目本地) // - CLI --skill 参数指定的路径 } // 将技能格式化为系统提示词 export function formatSkillsForPrompt(skills: Skill[]): string { const lines = [ "The following skills provide specialized instructions for specific tasks.", "Use the read tool to load a skill's file when the task matches its description.", ... "<available_skills>", ]; for (const skill of visibleSkills) { lines.push(` <skill>`); lines.push(` <name>${skill.name}</name>`); lines.push(` <description>${skill.description}</description>`); lines.push(` <location>${skill.filePath}</location>`); lines.push(` </skill>`); } return lines.join("\n"); }
```

2.  系统提示词中：只告诉AI有哪些技能（名称+描述），不包含详细内容
    
3.  AI按需加载：当任务匹配技能描述时，AI用read工具读取完整的SKILL.md
    

```markdown
--- name: pdf-processing description: Extracts text and tables from PDF files. Use when working with PDF documents. --- # PDF Processing ## Setup Run once before first use: bash cd /path/to/pdf-processing && npm install
```

## 

Usage

./extract-text.js <input.pdf> # Extract text ./extract-tables.js <input.pdf> # Extract tables

Skill就是Markdown文件。当AI读取它时，内容立即进入上下文。\*\*没有注册过程，没有重启需求\*\*——这就是"编写即用，修改即生效"。

可迁移经验： - ✅ 使用"渐进式披露"：只把必要信息放系统提示词，详细内容按需加载 - ✅ 文档即代码：用Markdown写"能力"，而不是写代码 - ✅ 让AI自己找工具：告诉AI"有什么"，让它自己决定"用什么"

## 

4\. 实时干预：转向队列（Steering Queue）

这是Pi最独特的功能之一。在 \`packages/agent/src/agent.ts\` 中：

```typescript
export class Agent { private steeringQueue: AgentMessage[] = []; // 转向队列 private followUpQueue: AgentMessage[] = []; // 后续队列 /** * 发送转向消息：中断当前执行 * 在当前工具执行完成后立即处理，跳过剩余工具 */ steer(m: AgentMessage) { this.steeringQueue.push(m); } /** * 发送后续消息：在当前轮次完全结束后处理 */ followUp(m: AgentMessage) { this.followUpQueue.push(m); } }
```

```typescript
async function executeToolCalls(...) { for (let index = 0; index < toolCalls.length; index++) { const toolCall = toolCalls[index]; // 执行工具... const result = await tool.execute(...); // 关键：每个工具执行后检查转向消息 if (getSteeringMessages) { const steering = await getSteeringMessages(); if (steering.length > 0) { steeringMessages = steering; // 跳过剩余工具调用 const remainingCalls = toolCalls.slice(index + 1); for (const skipped of remainingCalls) { results.push(skipToolCall(skipped, stream)); } break; } } } return { toolResults: results, steeringMessages }; }
```

-   正常情况：AI调用工具A → 调用工具B → 调用工具C → 完成任务
    
-   发现问题：你看到AI走错方向了
    
-   你发送消息："等等，不要用那个方法"
    
-   Pi的处理：如果消息进入转向队列(steer)：当前工具执行完后，立即处理你的消息，跳过剩余工具 如果消息进入\*\*后续队列(followUp)\*\*：等AI这一轮完全结束后再处理
    

-   ✅ 给用户"干预权"：允许在AI执行中实时纠正
    
-   ✅ 区分"紧急"和"非紧急"：设计不同的队列机制
    
-   ✅ 优雅中断：不要强制终止，而是让当前操作完成后自然过渡
    

Pi明确拒绝向量数据库、记忆银行等外部记忆系统。看 compaction/compaction.ts 中的上下文管理：

```typescript
export interface CompactionSettings { enabled: boolean; reserveTokens: number; // 预留token数（默认16384） keepRecentTokens: number; // 保留最近对话token数（默认20000） } // 当上下文窗口快满时，压缩历史 export function shouldCompact(contextTokens: number, contextWindow: number, settings: CompactionSettings): boolean { return contextTokens > contextWindow - settings.reserveTokens; } // 压缩策略：保留最近N个token的对话，更早的用LLM总结 export function findCutPoint( entries: SessionEntry[], startIndex: number, endIndex: number, keepRecentTokens: number, ): CutPointResult { // 从最新消息开始，向前累积token // 当超过keepRecentTokens时，在那个点"切断" // 更早的内容会被LLM总结成摘要 }
```

1.  优先用真实代码：AI直接用read/grep读取项目文件，而不是依赖可能过时的摘要
    
2.  对话历史管理：当上下文快满时，把太旧的对话压缩成摘要
    
3.  摘要格式：保留目标、约束、进度、关键决策、下一步——结构化信息，而不是向量嵌入
    

-   ✅ 结构化摘要优于向量检索：用LLM生成"人类可读"的摘要，而不是不可解释的嵌入
    
-   ✅ 源码即真相：让AI直接读文件，而不是依赖可能过期的"记忆"
    
-   ✅ 渐进压缩：保留最近完整对话，旧的只保留摘要
    

Pi的设计告诉我们：在AI时代，减法比加法更难，但也更有价值。当其他框架在比拼功能列表长度时，Pi证明了——一个设计良好的极简系统，可以通过组合和扩展，完成复杂系统能做到的一切，同时保持清晰和可控