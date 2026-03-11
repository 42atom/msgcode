# 深度代码质量审查报告（开源就绪）

> 审查范围：`src/` 全目录  
> 审查维度：死代码、双/三真相源、僵尸兼容层、命名不一致、功能空壳

---

## 第一层：已确认的 5 个问题（前轮审查）

| # | 类别 | 核心问题 | 严重性 |
|---|------|----------|--------|
| 1 | PI 残留 | `PI_ON_TOOLS` 5 个幽灵工具名 + `pi.enabled` 无效开关 | 高 |
| 2 | LmStudio 命名 | 双 [getToolsForLlm](file:///Users/admin/GitProjects/msgcode/src/agent-backend/tool-loop.ts#1072-1117) + ~50 处 LmStudio 旧名 | 中 |
| 3 | Skill Registry | [runSkill()](file:///Users/admin/GitProjects/msgcode/src/skills/auto.ts#88-123) 永远失败 + [getSkillIndex()](file:///Users/admin/GitProjects/msgcode/src/skills/registry.ts#164-173) 双真相源 | 中 |
| 4 | providers/tool-loop.ts | 整文件 deprecated，[runToolLoop](file:///Users/admin/GitProjects/msgcode/src/providers/tool-loop.ts#125-138) 直接 throw | 低 |
| 5 | ToolingMode | 类型定义了但 tool-loop 从不读取 | 低 |

---

## 第二层：新发现的问题

### 6. Skills 三真相源 🔴

技能系统现在有 **三套并行定义**：

| 文件 | [SkillMatch](file:///Users/admin/GitProjects/msgcode/src/skills/auto.ts#12-17) 定义 | [runSkill](file:///Users/admin/GitProjects/msgcode/src/skills/auto.ts#88-123) 定义 | [SkillId](file:///Users/admin/GitProjects/msgcode/src/skills/auto.ts#10-11) 定义 |
|------|-------------------|-----------------|----------------|
| [types.ts](file:///Users/admin/GitProjects/msgcode/src/skills/types.ts#L49) | `interface SkillMatch` (L49) | — | `BuiltinSkillId` union (L24) |
| [registry.ts](file:///Users/admin/GitProjects/msgcode/src/skills/registry.ts#L225) | import from types.ts | [runSkill()](file:///Users/admin/GitProjects/msgcode/src/skills/auto.ts#88-123) → 永远失败 (L225) | import from types.ts |
| [auto.ts](file:///Users/admin/GitProjects/msgcode/src/skills/auto.ts#L12) | **独立** `interface SkillMatch` (L12) | **独立** [runSkill()](file:///Users/admin/GitProjects/msgcode/src/skills/auto.ts#88-123) → 只认 `system-info` (L88) | **独立** `type SkillId = "system-info"` (L10) |

[index.ts](file:///Users/admin/GitProjects/msgcode/src/skills/index.ts) 同时导出两套：
```typescript
export { runSkill } from "./registry.js";          // 永远失败版
export { runSkill as runLegacySkill } from "./auto.js";  // 只认 system-info 版
export { type SkillMatch as LegacySkillMatch } from "./auto.js";
export { type SkillMatch } from "./types.js";       // 冲突！
```

**风险**：外部消费者 import [SkillMatch](file:///Users/admin/GitProjects/msgcode/src/skills/auto.ts#12-17) 和 [runSkill](file:///Users/admin/GitProjects/msgcode/src/skills/auto.ts#88-123) 时，得到的是 registry 的永远失败版。而真正能跑的 `system-info` 在 `runLegacySkill` 里。命名完全反直觉。

---

### 7. [getToolPolicy()](file:///Users/admin/GitProjects/msgcode/src/config/workspace.ts#631-647) 双真相源 🔴

| 文件 | 行 | 返回类型 |
|------|-----|---------|
| [bus.ts](file:///Users/admin/GitProjects/msgcode/src/tools/bus.ts#L66) | 66 | `Promise<ToolPolicy>` (import from types.ts) |
| [workspace.ts](file:///Users/admin/GitProjects/msgcode/src/config/workspace.ts#L637) | 637 | `Promise<{ mode; allow; requireConfirm }>` (内联) |

两个同名函数，不同文件，不同返回类型（一个用 [ToolPolicy](file:///Users/admin/GitProjects/msgcode/src/tools/types.ts#88-93) interface，一个用匿名对象）。[bus.ts](file:///Users/admin/GitProjects/msgcode/src/tools/bus.ts) 那个是运行时真正的消费者；[workspace.ts](file:///Users/admin/GitProjects/msgcode/src/config/workspace.ts) 那个被谁用需要排查。

---

### 8. [getFsScope()](file:///Users/admin/GitProjects/msgcode/src/config/workspace.ts#687-700) 功能空壳 🟡

[workspace.ts L693-699](file:///Users/admin/GitProjects/msgcode/src/config/workspace.ts#L693-L699)：
```typescript
export async function getFsScope(projectDir: string): Promise<"workspace" | "unrestricted"> {
  void projectDir;  // 参数直接丢弃
  return "unrestricted";  // 永远返回 unrestricted
}
```

配上完整的 [setFsScope()](file:///Users/admin/GitProjects/msgcode/src/config/workspace.ts#701-713) (L707) 和 config 字段 `tooling.fs_scope`——用户能写但读永远忽略。**对开源用户来说这是一个安全功能的假承诺。**

---

### 9. Workspace Config 僵尸字段 🟡

`DEFAULT_WORKSPACE_CONFIG` 里有几个值得注意的问题：

| 字段 | 值 | 问题 |
|------|-----|------|
| `pi.enabled` | **在 interface 中但不在 DEFAULT 里** | [WorkspaceConfig](file:///Users/admin/GitProjects/msgcode/src/config/workspace.ts#31-186) interface 没列但 [cmd-model.ts](file:///Users/admin/GitProjects/msgcode/src/routes/cmd-model.ts) 在读写 |
| `runner.default` | `"agent-backend"` | 注释说 "v2.4.0 移除"，仍在 |
| `tooling.allow` L253 | 12 个工具 | 注释说"默认文件主链收口为 read_file + bash"，实际开了 12 个 |
| `tooling.fs_scope` | `"unrestricted"` | 配了但 [getFsScope()](file:///Users/admin/GitProjects/msgcode/src/config/workspace.ts#687-700) 根本不读 |

---

### 10. AgentProvider 类型包含僵尸值 🟡

[workspace.ts L198](file:///Users/admin/GitProjects/msgcode/src/config/workspace.ts#L198)：
```typescript
export type AgentProvider = "agent-backend" | "lmstudio" | "minimax" | "deepseek" | "openai" | "llama" | "claude";
```

其中 `"lmstudio"`, `"llama"`, `"claude"` 在 [mapRunnerToKindProviderClient()](file:///Users/admin/GitProjects/msgcode/src/config/workspace.ts#372-404) 里全部降级为 `agent-backend`。它们作为 provider 值没有任何独立行为，但用户可以配置它们，获得和 `"agent-backend"` 完全相同的结果。

---

## 全局问题：命名一致性

开源代码库的入门障碍之一是命名混乱。当前存在多条命名轴：

| 概念 | 出现的命名变体 |
|------|---------------|
| 后端调用 | `LmStudio*`, `Agent*`, `MiniMax*` |
| 工具列表 | `PI_ON_TOOLS`, `AGENT_TOOLS`, `TOOL_MANIFESTS`, [AidocsToolDef](file:///Users/admin/GitProjects/msgcode/src/lmstudio.ts#62-63) |
| 运行技能 | [runSkill](file:///Users/admin/GitProjects/msgcode/src/skills/auto.ts#88-123) (registry), [runSkill](file:///Users/admin/GitProjects/msgcode/src/skills/auto.ts#88-123) (auto), `runLegacySkill`, [runAutoSkill](file:///Users/admin/GitProjects/msgcode/src/skills/auto.ts#124-149) |
| 获取工具 | [getToolsForLlm](file:///Users/admin/GitProjects/msgcode/src/agent-backend/tool-loop.ts#1072-1117) (tool-loop), [getToolsForLlm](file:///Users/admin/GitProjects/msgcode/src/agent-backend/tool-loop.ts#1072-1117) (lmstudio), `getToolsForAgent` |
| 工具策略 | [getToolPolicy](file:///Users/admin/GitProjects/msgcode/src/config/workspace.ts#631-647) (bus), [getToolPolicy](file:///Users/admin/GitProjects/msgcode/src/config/workspace.ts#631-647) (workspace) |
| 技能匹配 | [SkillMatch](file:///Users/admin/GitProjects/msgcode/src/skills/auto.ts#12-17) (types), [SkillMatch](file:///Users/admin/GitProjects/msgcode/src/skills/auto.ts#12-17) (auto), `LegacySkillMatch` |

---

## 清理优先级建议

### P0 — 开源前必须清理
1. **删 PI 残留**：`PI_ON_TOOLS`, `AGENT_TOOLS`, `pi.enabled` 读写
2. **删 lmstudio.ts 的影子 getToolsForLlm**：消除双真相源
3. **删 providers/tool-loop.ts**：整文件
4. **修 getFsScope**：要么读配置，要么删掉 [setFsScope](file:///Users/admin/GitProjects/msgcode/src/config/workspace.ts#701-713) 和 config 字段
5. **统一 getToolPolicy**：保留一个，删另一个

### P1 — 开源后尽快清理
6. **合并 skills 三真相源**：只保留一套 [SkillMatch](file:///Users/admin/GitProjects/msgcode/src/skills/auto.ts#12-17) + [runSkill](file:///Users/admin/GitProjects/msgcode/src/skills/auto.ts#88-123)
7. **修正 tooling.allow 注释**：注释与实际列表不一致
8. **删 runner.default 兼容层**：或用 `@deprecated` 明确标注
9. **清理 AgentProvider 僵尸值**：`lmstudio`/`llama`/`claude`

### P2 — 持续改善
10. **统一 LmStudio → Agent 命名**：内部函数批量 rename
