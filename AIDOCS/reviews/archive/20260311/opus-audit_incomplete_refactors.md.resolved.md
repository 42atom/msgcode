# 收口未完成工作审查报告

> 审查范围：`src/` 全目录，聚焦"声明已迁移/退役但残留仍存在"的半吊子模式。

---

## 1. PI 残留（已讨论，此处汇总）

| 残留 | 文件 | 行 | 状态 |
|------|------|-----|------|
| `PI_ON_TOOLS` 常量 | [types.ts](file:///Users/admin/GitProjects/msgcode/src/agent-backend/types.ts#L65-L75) | 65-75 | 含 5 个幽灵工具名，无消费者 |
| `AGENT_TOOLS` re-export | [agent-backend.ts](file:///Users/admin/GitProjects/msgcode/src/agent-backend.ts#L70) | 70 | PI_ON_TOOLS 的别名，无消费者 |
| `pi.enabled` 配置读写 | [cmd-model.ts](file:///Users/admin/GitProjects/msgcode/src/routes/cmd-model.ts#L726) | 726,753,761 | 用户可切换但 tool-loop 已不看 |
| `pi.enabled` 默认值 | [workspace.ts](file:///Users/admin/GitProjects/msgcode/src/config/workspace.ts#L258) | 258 | 默认 true 但无效果 |

**建议**：全删。

---

## 2. LmStudio → Agent 重命名做了一半

`agent-backend/` 已建立 `runAgent*` 正名函数，但 **LmStudio 旧名在核心模块内部仍大量使用**：

| 类型 | 示例 | 数量 |
|------|------|------|
| 别名 export | `runLmStudioChat = runAgentChat` | 3 处（chat/tool-loop/routed-chat） |
| 再转发 | [lmstudio.ts](file:///Users/admin/GitProjects/msgcode/src/lmstudio.ts) L73-76 全文 re-export | 4 条 |
| 内部类型名 | `LmStudioNativeChatParams`, `LmStudioOpenAIChatParams` 等 | ~10 个 |
| 内部函数名 | `runLmStudioChatNative()`, `resolveLmStudioModelId()` 等 | ~8 个 |
| `sanitizeLmStudioOutput` | 被 tool-loop.ts 直接使用（非别名） | 3 处调用 |

> [!IMPORTANT]
> [lmstudio.ts](file:///Users/admin/GitProjects/msgcode/src/lmstudio.ts) 整个文件声称是"兼容层"，但它还有自己的 [getToolsForLlm()](file:///Users/admin/GitProjects/msgcode/src/agent-backend/tool-loop.ts#1072-1117) 实现（返回 `description: ""` 的空壳），与 tool-loop.ts 的同名函数冲突。**这是双真相源**。

**建议**：[lmstudio.ts](file:///Users/admin/GitProjects/msgcode/src/lmstudio.ts) 的 [getToolsForLlm](file:///Users/admin/GitProjects/msgcode/src/agent-backend/tool-loop.ts#1072-1117) 必须删除。其余别名可批量 rename 或保持（风险较低）。

---

## 3. Skill Registry 整个文件是占位

[registry.ts](file:///Users/admin/GitProjects/msgcode/src/skills/registry.ts) 文件头写了"退役说明"，但：

- [runSkill()](file:///Users/admin/GitProjects/msgcode/src/skills/registry.ts#217-242) — 只 return `{ ok: false }`，永远失败
- [detectSkillMatch()](file:///Users/admin/GitProjects/msgcode/src/skills/registry.ts#186-216) — 关键词匹配，从 [skills/index.ts](file:///Users/admin/GitProjects/msgcode/src/skills/index.ts) 导出，**可能仍有人调用**
- [getSkillIndex()](file:///Users/admin/GitProjects/msgcode/src/skills/registry.ts#164-173) — 存在两份：[skills/registry.ts](file:///Users/admin/GitProjects/msgcode/src/skills/registry.ts) L167 和 [runtime/skill-orchestrator.ts](file:///Users/admin/GitProjects/msgcode/src/runtime/skill-orchestrator.ts) L96，**双真相源**
- `builtinSkills` Map — 注册了 9 个 skill，其中 2 个标了 `deprecated`，其余 7 个的 [runSkill](file:///Users/admin/GitProjects/msgcode/src/skills/registry.ts#217-242) 都不通

**建议**：确认 [detectSkillMatch](file:///Users/admin/GitProjects/msgcode/src/skills/registry.ts#186-216) 是否仍有调用者。如果没有，整个 [registry.ts](file:///Users/admin/GitProjects/msgcode/src/skills/registry.ts) 可删。

---

## 4. [providers/tool-loop.ts](file:///Users/admin/GitProjects/msgcode/src/providers/tool-loop.ts) — 完整尸体

- 文件头 `@deprecated`
- [runToolLoop()](file:///Users/admin/GitProjects/msgcode/src/providers/tool-loop.ts#125-138) 直接 `throw`
- 但仍保留了 [parseXmlToolCall](file:///Users/admin/GitProjects/msgcode/src/providers/tool-loop.ts#55-67), [parseJsonToolCall](file:///Users/admin/GitProjects/msgcode/src/lmstudio.ts#143-155), [parseToolCallBestEffort](file:///Users/admin/GitProjects/msgcode/src/providers/tool-loop.ts#102-120) 等解析函数
- 这些函数在 [lmstudio.ts](file:///Users/admin/GitProjects/msgcode/src/lmstudio.ts) 里有**另一套独立实现**（功能更完整）

**建议**：整文件删除。如果有人 import 解析函数，指向 [lmstudio.ts](file:///Users/admin/GitProjects/msgcode/src/lmstudio.ts) 的版本。

---

## 5. [ToolingMode](file:///Users/admin/GitProjects/msgcode/src/tools/types.ts#8-9) 类型定义了但未接入

[types.ts](file:///Users/admin/GitProjects/msgcode/src/tools/types.ts#L8) L8：
```typescript
export type ToolingMode = "explicit" | "autonomous" | "tool-calls";
```

这是 PI 时代设计的工具策略模式，定义了三种模式。但 tool-loop 入口从不读取 [ToolingMode](file:///Users/admin/GitProjects/msgcode/src/tools/types.ts#8-9)，工具循环永远以 `autonomous` 模式执行。

**建议**：要么接上（用 `explicit` 替代 `pi.enabled` 的一键开关功能），要么删掉。

---

## 总结：5 类半吊子

| # | 类别 | 严重性 | 风险 |
|---|------|--------|------|
| 1 | PI 残留 | 高 | `pi.enabled` 对用户可见但无效 |
| 2 | LmStudio 命名 | 中 | 双 [getToolsForLlm](file:///Users/admin/GitProjects/msgcode/src/agent-backend/tool-loop.ts#1072-1117) 是真相源冲突 |
| 3 | Skill Registry | 中 | [getSkillIndex](file:///Users/admin/GitProjects/msgcode/src/skills/registry.ts#164-173) 双真相源 + 全部 skill 执行不通 |
| 4 | providers/tool-loop.ts | 低 | 纯死代码，无运行时影响 |
| 5 | ToolingMode | 低 | 僵尸类型，无运行时影响 |
