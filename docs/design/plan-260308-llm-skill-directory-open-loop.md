# Plan: LLM Skill 目录开放循环

## Problem

LLM 能读取 skill 文件，但读取后框架阻止它继续执行：
- `Tool Bus: SUCCESS read_file` 成功后
- 出现 `未暴露工具：bash`
- `错误码：MODEL_PROTOCOL_FAILED`

模型已经想继续做事，但框架中途把它拦住了。

## Occam Check

### 1. 不加这次改动，系统具体坏在哪？

**证据**：
- 用户发送「每分钟发给我一次 cron live」
- LLM 读取了 scheduler skill（进步）
- LLM 想执行 `bash` 创建 cron job（合理动作）
- 框架返回 `MODEL_PROTOCOL_FAILED`（阻断）
- 用户仍然无法完成任务

**问题**：半套能力 - 能读不能做

### 2. 用更少的层能不能解决？

**推荐方案**：暴露完整工具面给 LLM

选项：
- **方案 A**：skill 场景下默认暴露全部工具（推荐）
  - 优点：最小改动，一处配置
  - 逻辑：skill 场景不再限制工具

- **方案 B**：针对特定 skill（scheduler）特判暴露
  - 风险：变成特判地狱

- **方案 C**：新增 skill-first 路由
  - 改动太大，不符合最小原则

**推荐：方案 A** - 最小改动，让 LLM 自行决定使用什么工具

### 3. 这个改动让主链数量变多了还是变少了？

- 主链数量不变（仍然是 route → tool-loop → execute）
- 消除了"半套能力"状态

## Decision

**选型：skill 场景下默认暴露完整工具**

核心理由：
1. skill 文件本身已经描述了安全边界，LLM 会按 skill 指示行动
2. 框架不应该替 LLM 做"你能用什么工具"的判断
3. 最小改动原则

## Plan

### 步骤 1：查清阻断点

**检查代码**：
- `tool-loop.ts` - `getToolsForLlm()` 目前只返回 `["read_file"]`
- `routed-chat.ts` - 工具可用性判断
- `bus.ts` - `MODEL_PROTOCOL_FAILED` 触发点

**根因**：`getToolsForLlm()` 在 skill 场景只返回 `["read_file"]`，没有暴露其他必要工具

### 步骤 2：实现修复

**改动文件**：`src/agent-backend/tool-loop.ts`

**方案**：skill 场景下默认暴露全部工具

具体逻辑：
```typescript
export async function getToolsForLlm(workspacePath?: string): Promise<ToolName[]> {
    // P5.7-R15 + P5.7-R16: skill 场景默认暴露完整工具
    if (!workspacePath) {
        return ["read_file", "bash", "browser", "edit", "write", "glob", "grep", "web_fetch", "web_search"];
    }
    // ... 现有逻辑
}
```

### 步骤 3：明确告知 LLM skills 目录

**改动文件**：`src/agent-backend/prompt.ts`

在 system prompt 中注入：
- runtime skills 目录：`/Users/admin/.config/msgcode/skills/`
- 当前 workspace 路径
- 必要环境路径

### 步骤 4：测试

**改动文件**：更新 `test/p5-7-r15-agent-read-skill.test.ts`

**验收点**：
- skill 场景下 read_file 可用
- skill 场景下 bash 也可用
- 日志出现真实 bash 执行

### 步骤 5：真机 smoke

- 发送「每分钟发给我一次 cron live」
- 验证：
  1. LLM 读取 scheduler skill
  2. LLM 继续执行 bash 创建 cron job
  3. 日志出现真实工具调用

## Risks

### 主要风险

1. **工具暴露过多**
   - 风险：默认允许所有工具可能不安全
   - 缓解：skill 文件描述了安全边界，LLM 会遵守

2. **破坏现有 no-tool 路由**
   - 风险：修改后影响其他场景
   - 缓解：只在 workspacePath 为空时生效（skill 场景）

## Test Plan

1. 单元测试：
   - workspacePath 为空时返回完整工具列表

2. 集成测试：
   - 自然语言 skill 场景触发完整工具链

## Observability

- 日志：`Tool Bus: SUCCESS bash`
- 不再出现 `MODEL_PROTOCOL_FAILED`（除非真实失败）
- 不再出现伪 `[TOOL_CALL] ...`

---

**评审意见**：[留空,用户将给出反馈]
