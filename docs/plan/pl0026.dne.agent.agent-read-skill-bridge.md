# Plan: Agent 读 Skill 桥断裂修复

## Problem

自然语言 agent-first 轮次无法真实执行 `read_file` 读取 runtime skill：
- 日志显示 `no tools exposed`
- 最终只输出伪 `[TOOL_CALL] read_file ...` 文本
- 模型知道应该读 skill，但运行时没有真正执行工具

## Occam Check

### 1. 不加这次改动，系统具体坏在哪？

**证据**：
- 用户发「每分钟发给我一次 cron live」
- 日志：`agent-first chat fallback: no tools exposed`
- 原因：workspace `smoke/ws-a` 没有 `pi.enabled: true`
- `getToolsForLlm()` 返回空数组 → `toolsAvailable = false` → 落到 no-tool 路由

**问题**：scheduler skill 无法通过自然语言被触发，用户请求永远只得到伪工具调用文本。

### 2. 用更少的层能不能解决？

**推荐方案**：让 `read_file` 在 skill 场景下默认可用

选项：
- **方案 A**：skill 场景下默认允许 read_file（推荐）
  - 优点：最小改动，一行代码
  - 逻辑：检测到是 skill 相关任务时，默认暴露 read_file

- **方案 B**：放宽 getToolsForLlm 的 pi.enabled 检查
  - 风险：可能暴露过多工具

- **方案 C**：新增 skill-first 路由
  - 改动太大，不符合最小原则

**推荐：方案 A** - 最小改动，只让 read_file 可用

### 3. 这个改动让主链数量变多了还是变少了？

- 主链数量不变（仍然是 route → tool-loop → execute）
- 但修复了 skill 场景下的工具暴露断裂

## Decision

**选型：skill 场景下默认暴露 read_file**

核心理由：
1. skill 读取是最低限度能力，不涉及危险操作
2. scheduler skill 需要读 SKILL.md 才能正确执行
3. 最小改动原则

## Plan

### 步骤 1：确认根因

**检查代码**：
- `tool-loop.ts:512-540` - `getToolsForLlm()`
- `routed-chat.ts:71-73` - `toolsAvailable` 计算

**根因**：`pi.enabled` 检查导致返回空数组

### 步骤 2：实现修复

**改动文件**：`src/agent-backend/tool-loop.ts`

**方案**：在 skill 场景下，默认允许 read_file

具体逻辑：
```typescript
export async function getToolsForLlm(workspacePath?: string): Promise<ToolName[]> {
    if (!workspacePath) {
        // P5.7-R15: skill 场景默认允许 read_file
        return ["read_file"];
    }
    // ... 现有逻辑
}
```

### 步骤 3：测试

**改动文件**：新增测试 `test/p5-7-r15-agent-read-skill.test.ts`

**验收点**：
- 自然语言 skill 场景下 read_file 可用
- 日志出现 `Tool Bus: SUCCESS read_file`

### 步骤 4：真机 smoke

- 发送「每分钟发给我一次 cron live」
- 验证日志出现真实 read_file 执行

## Risks

### 主要风险

1. **read_file 暴露过多**
   - 风险：默认允许可能不安全
   - 缓解：只允许 read_file，不允许 write_file/bash

2. **破坏现有 no-tool 路由**
   - 风险：修改后影响其他场景
   - 缓解：只在 workspacePath 为空时生效

## Test Plan

1. 单元测试：
   - workspacePath 为空时返回 ["read_file"]
   - workspacePath 存在时走原有逻辑

2. 集成测试：
   - 自然语言 skill 场景触发 read_file

## Observability

- 日志：`Tool Bus: SUCCESS read_file`
- 路由：不再落到 `no-tool`

---

**评审意见**：[留空，用户将给出反馈]
