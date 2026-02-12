# RunnerType 收敛变更 Checklist

> 目的：记录"runnerType 收敛"核心变更，方便 code review/回溯
>
> 变更时间：2025-02-08
> 关联任务：TASK_MULTI_PROVIDER_MIGRATION

---

## 一句话总结

```
旧: RunnerType = "claude" | "codex" | "claude-code" | "local" (混用)
新: RunnerType = "tmux" | "direct" (运行时分类)
    + RunnerTypeOld = "claude" | "codex" | "claude-code" | "local" (存储兼容)
    + normalizeRunnerType(oldOrNew) → "tmux" | "direct"
```

---

## 核心变更文件

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/tmux/session.ts` | 🔴 核心 | 新增 RunnerTypeOld, RunnerType, normalizeRunnerType() |
| `src/tmux/registry.ts` | 🔴 核心 | SessionRecord 双写 runnerType + runnerOld，读写守卫 |
| `src/tmux/responder.ts` | 🔴 核心 | ResponseOptions 拆分 runnerType + runnerOld，isCodex → isCoderCLI |
| `src/handlers.ts` | 🔴 核心 | resolveRunner 返回 { runner, runnerConfig }，tmux 命令 gate |
| `src/config/workspace.ts` | 🟡 类型 | RunnerConfig 扩展（llama, claude, openai） |
| `src/routes/commands.ts` | 🟢 逻辑 | /model 命令添加 planned 执行臂 |
| `test/tmux.responder.runner.test.ts` | 🟢 测试 | 新增守卫测试（claude-code → Coder CLI 分支） |
| `test/handlers.tmux-gate.test.ts` | 🟢 测试 | 新增守卫测试（direct runner gate） |

---

## 核心变更详解

### 1. 类型定义拆分（session.ts）

**变更前**：
```typescript
export type RunnerType = "claude" | "codex";
```

**变更后**：
```typescript
// 旧执行臂类型（存储层兼容）
export type RunnerTypeOld = "claude" | "codex" | "claude-code" | "local";

// 新执行臂类型（运行时分类）
export type RunnerType = "tmux" | "direct";

// 归一化函数
export function normalizeRunnerType(oldOrNew: string): RunnerType {
    const tmuxRunners = ["codex", "claude-code"];
    const directRunners = ["claude", "local", "mlx", "lmstudio", "llama", "tmux", "direct"];
    if (tmuxRunners.includes(oldOrNew)) return "tmux";
    if (directRunners.includes(oldOrNew)) return "direct";
    logger.warn(`未知的执行臂类型: ${oldOrNew}，默认使用 direct`);
    return "direct";
}
```

**影响**：TmuxSession.start() 现在同时接收 runner（新类型）和 runnerOld（旧类型）

---

### 2. Registry 双写 + 守卫（registry.ts）

**变更前**：
```typescript
export interface SessionRecord {
  runner: RunnerType;  // 旧类型
}
```

**变更后**：
```typescript
export interface SessionRecord {
  runner: RunnerTypeOld;        // 旧类型（存储兼容）
  runnerType?: "tmux" | "direct"; // 新类型（读时优先）
}

// 写入守卫：强制从 record.runner 推断 runnerType
export async function upsertSession(record: Omit<SessionRecord, "createdAtMs" | "updatedAtMs" | "lastStartAtMs" | "lastStopAtMs" | "runnerType">) {
    const runnerType: "tmux" | "direct" = normalizeRunnerType(record.runner);
    // ... 双写 runner + runnerType
}

// 读守卫：校验 runnerType 有效性
function validateOrNormalizeRunnerType(record: SessionRecord): "tmux" | "direct" {
    if (record.runnerType === "tmux" || record.runnerType === "direct") {
        return record.runnerType;
    }
    return normalizeRunnerType(record.runner);
}
```

**影响**：registry 读写都有守卫，防止坏数据污染

---

### 3. Responder 类型语义修正（responder.ts）

**变更前**：
```typescript
export interface ResponseOptions {
    runner?: RunnerType;  // "tmux"|"direct"，但代码用 "claude"|"codex"
}

const isCodex = runner === "codex";
```

**变更后**：
```typescript
export interface ResponseOptions {
    runnerType?: RunnerType;      // "tmux"|"direct"（运行时分类）
    runnerOld?: RunnerTypeOld;    // "claude"|"codex"|"claude-code"|"local"（具体执行臂）
}

const isCoderCLI = runnerOld === "codex" || runnerOld === "claude-code";
const coderReader = isCoderCLI ? new CodexOutputReader() : null;
const coderJsonlPath = isCoderCLI ? await coderReader!.findLatestJsonlForWorkspace(...) : null;
```

**影响**：claude-code 现在正确走 Codex 分支（JSONL 逻辑、timeout）

---

### 4. Handlers 逻辑收敛（handlers.ts）

**变更前**：
```typescript
const resolveRunner = async (): Promise<{ runner: RunnerType }> => {
    const r = await getDefaultRunner(projectDir);
    const runner: RunnerType = r === "codex" ? "codex" : "claude";
    return { runner };
};

// /start 无 gate
if (trimmed === "/start") {
    const r = await resolveRunner();
    const response = await TmuxSession.start(context.groupName, context.projectDir, r.runner);
}
```

**变更后**：
```typescript
const resolveRunner = async (): Promise<{
    runner: RunnerType;
    runnerConfig?: "mlx" | "lmstudio" | "llama" | "claude" | "openai" | "codex" | "claude-code";
}> => {
    const r = await getDefaultRunner(projectDir);
    const isTmuxRunner = r === "codex" || r === "claude-code";
    const runner: RunnerType = isTmuxRunner ? "tmux" : "direct";
    return { runner, runnerConfig: r };
};

// /start 有 gate
if (trimmed === "/start") {
    const r = await resolveRunner();
    if (r.runner !== "tmux") {
        return { success: true, response: `当前为 direct 执行臂...` };
    }
    const runnerOld = r.runnerConfig === "codex" || r.runnerConfig === "claude-code" ? r.runnerConfig : undefined;
    const response = await TmuxSession.start(context.groupName, context.projectDir, r.runner, runnerOld);
}
```

**影响**：
- /start /snapshot /esc /stop /status 都有 gate
- handleTmuxSend 调用口径统一（传 runnerType + runnerOld）

---

### 5. /model 命令口径对齐（commands.ts）

**变更前**：
```typescript
可用执行臂:
  lmstudio    本地模型（默认）
  mlx         MLX LM Server（工具闭环推荐）
  codex       Codex CLI（需要 egress-allowed）
  claude-code Claude Code CLI（需要 egress-allowed）
```

**变更后**：
```typescript
可用执行臂:
  lmstudio    本地模型（默认）
  mlx         MLX LM Server（工具闭环推荐）
  codex       Codex CLI（需要 egress-allowed）
  claude-code Claude Code CLI（需要 egress-allowed）

计划中（planned）:
  llama       llama-server / llama.cpp（*.gguf）
  claude      Anthropic Claude API
  openai      OpenAI API（GPT-4, o1, etc.）

// 输入校验：拒绝 planned 执行臂
const plannedRunners = ["llama", "claude", "openai"];
if (plannedRunners.includes(requestedRunner)) {
    return { success: false, message: `"${requestedRunner}" 执行臂尚未实现。...` };
}
```

---

## 守卫测试（新增 28 个）

### test/tmux.responder.runner.test.ts

- `守卫 #1: claude-code 必须走 Coder CLI 分支` - 验证 isCoderCLI 逻辑
- `守卫 #2: runnerType 和 runnerOld 必须分离` - 验证 ResponseOptions 类型
- `守卫 #3: runnerOld 名称对应关系` - 验证显示名称映射

### test/handlers.tmux-gate.test.ts

- `守卫 #1-6: /start /snapshot /esc /stop /status /clear gate` - 验证 direct runner gate
- `守卫 #7: resolveRunner 收敛逻辑` - 验证归一化函数
- `守卫 #8: handleTmuxSend 调用口径统一` - 验证参数传递

---

## 顺带改动（非核心，可忽略）

| 文件 | 改动 | 说明 |
|------|------|------|
| `src/session-artifacts.ts` | 新增 | session window 管理功能 |
| `src/summary.ts` | 新增 | summary 管理功能 |
| `AIDOCS/**/*.md` | 文档 | 文档更新 |
| `.env.example` | 配置 | 环境变量模板 |
| `features/*.feature` | 测试 | BDD 测试用例 |

---

## 验收标准

- [x] 类型定义拆分完成（RunnerType + RunnerTypeOld）
- [x] normalizeRunnerType() 函数实现
- [x] registry 双写 + 读写守卫
- [x] responder 类型语义修正
- [x] handlers 逻辑收敛 + tmux 命令 gate
- [x] /model 命令口径对齐
- [x] 守卫测试 28 个全部通过
- [x] isCodex → isCoderCLI 重命名
- [x] 测试通过：404 pass / 3 fail（imessage-kit，与修改无关）

---

## 后续待办

- [ ] 删除 RunnerTypeOld 字段的写入（仅保留读取兼容）
- [ ] 迁移完成后删除 RunnerTypeOld 类型定义
- [ ] 实现 llama / claude / openai provider

---

## 相关文档

- [Multi-Provider Architecture v2.2](./multi_provider_architecture_v2.2.md)
- [README v2.2](./README.md)
- [Local Runners Spec v2.1](../msgcode-2.1/local_runners_spec_v2.1.md)
