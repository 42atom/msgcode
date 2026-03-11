# 审核意见2专项修正文件清单

> 范围：只收口当前仍然有效的问题。  
> 不包含已在 `0084/0085` 修完的 PI 残留、`/pi` 命令、`pi.enabled`、`providers/tool-loop.ts` 等历史项。

---

## P0. `fs_scope` 假配置

### 问题

`tooling.fs_scope` 现在可以写，但运行时读取函数始终返回 `unrestricted`。这不是技术债，而是对外语义假承诺。

### 必改文件

- `src/config/workspace.ts`
  - 修 `getFsScope()`
  - 决定是否保留 `setFsScope()`
  - 决定默认值是否继续是 `"unrestricted"`
- `src/tools/bus.ts`
  - `read_file / write_file / edit_file` 的边界逻辑要跟 `getFsScope()` 真正对齐

### 必改测试

- `test/p5-7-r3i-fs-scope-policy.test.ts`
  - 现在很多断言锁的是“始终 unrestricted”，需要改成真实配置语义
- `test/tools.bus.test.ts`
  - 补文件工具在 `workspace/unrestricted` 两种模式下的行为锁

### 可能联动

- `test/p5-6-8-r3b-edit-file-patch.test.ts`
- `test/p5-7-r10-workspace-absolute-path-regression.test.ts`

---

## P0. Skills 历史尸体与三真相源

### 问题

当前 skills 相关逻辑至少有三层历史残留：

- `registry.ts`：占位注册表，`runSkill()` 永远失败
- `auto.ts`：只有 `system-info` 能跑
- `runtime/skill-orchestrator.ts`：又维护一份 `getSkillIndex()`

这不是可维护的兼容层，而是历史尸体堆。

### 必改文件

- `src/skills/registry.ts`
  - 优先判断是否直接删除
- `src/skills/index.ts`
  - 去掉把 `registry` 和 `auto` 混导出的反直觉接口
- `src/runtime/skill-orchestrator.ts`
  - 如果仍保留，必须和唯一 skill 真相源对齐
- `src/skills/auto.ts`
  - 明确它是否就是唯一保留的最小 auto-skill 实现
- `src/skills/types.ts`
  - 如果删 registry，需要同步收口类型面

### 必改测试

- `test/skills.auto.test.ts`
  - 继续锁 `auto.ts` 当前真实合同

### 文档联动

- `src/skills/README.md`
  - 把“历史占位/退役说明”改成和最终代码一致的口径

### 建议策略

- 最小可删版本：
  - 删 `registry.ts`
  - `skills/index.ts` 只导 `auto.ts` 当前最小实现
  - `runtime/skill-orchestrator.ts` 若无真实主链价值，继续做薄或直接退役

---

## P1. `getToolPolicy()` 单一真相源

### 问题

现在有两份 `getToolPolicy()`：

- `src/config/workspace.ts`
- `src/tools/bus.ts`

两边语义接近，但不是一个实现。这属于重复真相源。

### 必改文件

- `src/config/workspace.ts`
  - 保留为唯一 `getToolPolicy()` 真相源更自然
- `src/tools/bus.ts`
  - 删除本地实现，改为复用 `workspace.ts`
- `src/agent-backend/tool-loop.ts`
  - 已经在读 `workspace.ts#getToolPolicy()`，改后确认不受影响
- `src/routes/cmd-tooling.ts`
  - 确认仍然走统一来源

### 必改测试

- `test/tools.bus.test.ts`
  - 改为锁“Tool Bus 与 workspace 配置读取同源”

---

## P2. `AgentProvider` 僵尸值

### 问题

`AgentProvider` 仍包含：

- `lmstudio`
- `llama`
- `claude`

这些值现在没有独立行为，只会兼容映射或降级。

### 必改文件

- `src/config/workspace.ts`
  - `AgentProvider`
  - `mapRunnerToKindProviderClient()`
  - `getAgentProvider()/setAgentProvider()`

### 可能联动

- `test/p5-6-14-r1-config-mapping.test.ts`
- `test/routes.commands.test.ts`

### 备注

这条优先级低于 `fs_scope` 和 `skills`。

---

## P2. LmStudio 命名遗留

### 问题

现在已经不是双真相源事故，但仍有较多历史命名：

- `LmStudioNativeChatParams`
- `runLmStudioChatNative()`
- `resolveLmStudioModelId()`
- `sanitizeLmStudioOutput`
- `runLmStudioChat = runAgentChat`

### 必改文件

- `src/agent-backend/chat.ts`
- `src/lmstudio.ts`
- `src/providers/output-normalizer.ts`
- `src/agent-backend/index.ts`

### 可能联动测试

- `test/p5-7-r9-t4-agent-backend-neutral-naming.test.ts`
- `test/p5-7-r9-t6-lmstudio-hardcode-purge.test.ts`

### 备注

这是命名债，不是当前主链 bug。不要插队到 `fs_scope` 和 `skills` 前面。

---

## 推荐修正顺序

1. `fs_scope`
2. `skills` 历史尸体
3. `getToolPolicy()` 单一真相源
4. `AgentProvider` 僵尸值
5. `LmStudio` 命名债

---

## 非范围

以下问题已在前序提交中关闭，不再纳入本轮专项修正：

- `PI_ON_TOOLS`
- `AGENT_TOOLS`
- `/pi`
- `pi.enabled`
- `src/providers/tool-loop.ts`
- `ToolingMode 未接线`
- `lmstudio.ts` 影子 `getToolsForLlm()`
