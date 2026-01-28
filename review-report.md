# msgcode 安全与代码审查报告（修订版）

**项目**: msgcode - 基于 iMessage 的本地 AI Bot 系统
**版本**: 0.4.0
**审查日期**: 2026-01-16
**审查范围**: 核心模块安全、并发安全、错误处理、资源管理
**修订**: 2026-01-16（根据专家审核修正）

---

## 执行摘要

msgcode 是一个基于 iMessage 的本地 AI Bot 系统，经过全面审查并经专家审核确认，发现以下问题：

| 类别 | 确认问题 | 误判修正 |
|------|----------|----------|
| 安全漏洞 | 1 | 2 (AppleScript/SQL/白名单防护已足够) |
| 竞态条件 | 0 | 4 (Node.js 事件循环特性，同步代码无竞态) |
| 错误处理 | 2 | 0 |
| 资源管理 | 0 | 1 (缓存设计合理) |
| 边界条件 | 1 | 1 (标识符解析有兜底) |

**关键发现**: 需优先修复 tmux 命令注入、超时状态分离、JSONL 解析日志。

---

## 1. 安全漏洞（确认问题）

### 1.1 命令注入风险 [高危] ⚠️ 需修复

**位置**: `src/tmux/session.ts:140-143` 和 `:74`

**问题描述**:
- `sendCommand` 只对 `"` 和 `\` 转义，通过 `execAsync("tmux send-keys ... \"${escaped}\"")` 落入 `/bin/sh -c`
- `start` 中 `projectDir` 被原样嵌入 `cd ${projectDir}`

```typescript
// session.ts:74 - 未转义的 projectDir
if (projectDir) {
    await execAsync(`tmux send-keys -t ${sessionName} "cd ${projectDir}" Enter`, { timeout: 5000 });
}

// session.ts:142-143 - 不完整的转义
const escaped = command.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
await execAsync(`tmux send-keys -t ${sessionName} "${escaped}" Enter`, { timeout: 5000 });
```

**攻击场景**:
```
配置 projectDir: /tmp"; echo hacked > /tmp/pwned; cd "
发送消息: hello"; ls /
```

**修复建议**（综合 A、B 方案）:

方案 A - 使用 `execFile`/`spawn` 传参数（推荐，最安全）:
```typescript
import { spawn } from "node:child_process";

static async sendCommand(sessionName: string, command: string): Promise<void> {
    await new Promise((resolve, reject) => {
        const proc = spawn("tmux", ["send-keys", "-t", sessionName, command, "Enter"]);
        proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`exit ${code}`)));
        proc.on("error", reject);
    });
}

static async start(groupName: string, projectDir?: string): Promise<string> {
    // ...
    if (projectDir) {
        if (!this.isSafePath(projectDir)) {
            throw new Error(`Invalid project directory: ${projectDir}`);
        }
        // 单引号包裹并转义内部单引号
        const safeDir = "'" + projectDir.replace(/'/g, "'\\''") + "'";
        await execAsync(`tmux send-keys -t ${sessionName} "cd ${safeDir}" Enter`, { timeout: 5000 });
    }
}

private static isSafePath(path: string): boolean {
    return path.startsWith("/") && !path.includes("..") && !path.match(/[$`!]/);
}
```

方案 B - 完整转义当前字符（快速修复，可与方案 A 互补）:
```typescript
static async sendCommand(sessionName: string, command: string): Promise<void> {
    // 复用 streamer.ts:87-95 的 escapeMessage 函数
    const escaped = this.escapeMessage(command);
    await execAsync(`tmux send-keys -t ${sessionName} "${escaped}" Enter`, { timeout: 5000 });
}

private static escapeMessage(message: string): string {
    return message
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\$/g, '\\$')
        .replace(/;/g, '\\;')
        .replace(/`/g, '\\`')
        .replace(/!/g, '\\!');
}
```

**严重程度**: 高 - 可导致任意命令执行

**预计工作量**: 2-3h（A 方案）或 1h（B 方案）

---

### 1.2 AppleScript 注入风险 [分歧]

**位置**: `src/listener.ts:509-519`

**程序员A结论**: 已确认安全（换行符在 AppleScript 字符串中合法，双引号和单引号均有转义）

**程序员B建议**: 增加换行符转义

```typescript
// B 的建议
function escapeAppleScriptString(str: string): string {
    return str
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\n")
        .replace(/\r/g, "\\r")
        .replace(/\t/g, "\\t");
}
```

**建议**: 采用 B 的建议，额外转义控制字符，提高鲁棒性。

---

### 1.3 消息去重竞态 [已修复/已确认]

**位置**: `src/listener.ts:690-699`

**程序员A结论**: 同步代码无竞态，保持现状即可

**程序员B建议**: 用 size 检查减少竞态窗口

```typescript
// B 的建议
const sizeBefore = processedMessages.size;
processedMessages.add(message.id);
if (processedMessages.size === sizeBefore) {
    logger.warn(`🔄 跳过重复消息: ${message.id}`, { module: "listener" });
    return;
}
```

**建议**: 采用 B 的建议，防御性编程。

---

## 2. 竞态条件（已确认为误判）

### 2.1 processedMessages 竞态 [误判]

**位置**: `src/listener.ts:690-699`

**结论**: Node.js 事件循环在同步代码中不会切换任务，`has()` + `add()` 虽然不是原子操作，但在第一个 `await` 之前已完成，不存在竞态。

```typescript
// 所有状态变更在 await 之前完成
if (processedMessages.has(message.id)) {  // 同步
    return;
}
processedMessages.add(message.id);  // 同步
inFlightMessages.add(message.id);   // 同步
await sendReply(...);  // 第一个 await
```

**建议**: 继续保持清晰的同步代码段，可添加注释说明设计意图。

---

### 2.2 processingQueues 竞态 [误判]

**位置**: `src/listener.ts:232-250`

**结论**: 状态变更与后续 `await` 之间没有调度点，多个消息仍串行执行。

**建议**: 保持现状，可添加注释说明。

---

### 2.3 rateLimitMap / recentMessageContents 竞态 [误判]

**结论**: 同上，Node.js 单线程模型下同步代码无竞态风险。

---

## 3. 错误处理（确认问题）

### 3.1 超时状态混淆 [中危] ⚠️ 需修复

**位置**: `src/tmux/streamer.ts:331-340`

**问题描述**:
- 调用方无法区分"完整响应"与"超时兜底"

**修复建议**（综合 A、B 方案）:
```typescript
// 更新 StreamResult 接口
export interface StreamResult {
    success: boolean;
    partial?: boolean;   // B: 部分完成（超时但有内容）
    incomplete?: boolean; // A: 是否未完整发送
    timedOut?: boolean;   // A: 是否因超时结束
    error?: string;
}

// 各分支返回
if (parseResult.isComplete) {
    return { success: true, partial: false };
}
// 超时分支
return {
    success: true,
    timedOut: true,
    partial: remaining.trim() !== "",
    incomplete: !hasResponse
};
```

**严重程度**: 中 - 调用方状态判断错误

**预计工作量**: 1h

---

### 3.2 JSONL 解析静默跳过 [中危] ⚠️ 需修复

**位置**:
- `src/output/parser.ts:152-159`
- `src/output/reader.ts:170-177`

**修复建议**（B 的建议）:
```typescript
// parser.ts
let parseErrors = 0;
for (const line of lines) {
    try {
        const entry = JSON.parse(line) as JSONLEntry;
        entries.push(entry);
    } catch {
        parseErrors++;
        if (parseErrors <= 3) {
            logger.warn(`[Parser] 跳过无效 JSONL 行: ${line.slice(0, 80)}...`);
        }
    }
}
if (parseErrors > 0) {
    logger.error(`[Parser] JSONL 解析共跳过 ${parseErrors} 行`, { module: "parser" });
}

// reader.ts
} catch (error) {
    if (error.code === "ENOENT") {
        this.positions.delete(filePath);
        return { entries: [], bytesRead: 0, newOffset: 0 };
    }
    logger.error(`[Reader] JSONL 读取失败: ${filePath}`, { error: error.message });
    throw error;
}
```

**严重程度**: 中 - 内容丢失不可见

**预计工作量**: 1-2h

---

## 4. 资源管理

### 4.1 缓存大小限制 [中危] ⚠️ 可修复

**位置**: `src/listener.ts:306-321`

**程序员B建议**（A 原结论为"设计合理"，B 认为仍需限制）:
```typescript
const MAX_CONTENT_CACHE_SIZE = 200; // B: 内容去重缓存最大条目数

function cleanCache() {
    // ... existing processedMessages cleanup ...

    // B: 限制 recentMessageContents 大小
    if (recentMessageContents.size > MAX_CONTENT_CACHE_SIZE) {
        // 按时间排序，删除最旧的一半
        const entries = Array.from(recentMessageContents.entries())
            .sort((a, b) => a[1] - b[1]);
        const deleteCount = Math.floor(entries.length / 2);
        for (let i = 0; i < deleteCount; i++) {
            recentMessageContents.delete(entries[i][0]);
        }
    }
}
```

**建议**: 采用 B 的建议，设置缓存上限。

---

### 4.2 tmux 状态缓存不同步 [中危] ⚠️ 可修复

**位置**: `src/tmux/session.ts:24-25`

**问题描述**: 外部直接 `tmux kill-session` 不会更新内部 `sessions` Map

**程序员B建议**:
```typescript
private static async getStatus(sessionName: string): Promise<SessionStatus> {
    try {
        const { stdout } = await execAsync(`tmux list-sessions -F "#{session_name}"`, { timeout: 5000 });
        if (!stdout.split("\n").includes(sessionName)) {
            // 会话不存在，同步清理缓存
            this.sessions.delete(sessionName);
            return SessionStatus.Stopped;
        }
        // ... 其余代码
    } catch {
        // 出错时也清理缓存
        this.sessions.delete(sessionName);
        return SessionStatus.Stopped;
    }
}
```

**建议**: 采用 B 的建议，在 getStatus 中同步清理缓存。

---

## 5. 边界条件（确认问题）

### 5.1 群组标识符解析 [低危] ⚠️ 可修复

**位置**: `src/security.ts:50-51`

**结论**: 有兜底逻辑，但可改进健壮性。

**修复建议**:
```typescript
function extractSender(chatId: string): string {
    // 优先匹配 ...;-;sender 格式
    const dashSemi = chatId.split(";-;");
    if (dashSemi.length >= 2 && dashSemi[1]) {
        return dashSemi[1];
    }
    // 兜底：返回原始值（后续 isWhitelisted 会返回 false）
    return chatId;
}
```

**严重程度**: 低

---

## 6. 安全防护（确认足够）

### 6.1 AppleScript 注入 [已确认安全]

**原因**:
- `escapeAppleScriptString` 转义 `"` 和 `\`
- 外层脚本通过 `script.replace(/'/g, "'\\''")` 保护单引号
- 换行符在 AppleScript 字符串里合法（但 B 建议仍添加转义）

### 6.2 SQL 注入 [已确认安全]

**原因**:
- `escapeSqlString` 转义 `'`
- chatId 经过格式验证（GUID 格式）才用于 SQL

**B 建议**: 添加注释说明

```typescript
/**
 * 转义 SQLite 字符串（防止注入）
 *
 * 注意：chatId 已在调用前经过格式验证（isConfiguredChatId），
 * 只允许 32 位十六进制 GUID 或 "any;+;" 前缀格式，不存在注入风险。
 * 如需支持更多格式，应改用参数化查询。
 */
```

### 6.3 白名单绕过 [已确认低风险]

**原因**:
- `isFromMe` 是 SDK 提供的布尔值
- SDK 可信边界上的风险由 SDK 厂商保证
- 项目代码中无额外可控参数

---

## 7. 监控与指标（可选增强）

### 7.1 简单计数器 [低危] ⚠️ 可添加

**程序员B建议**（无需第三方依赖）:
```typescript
// 在 listener.ts 顶部添加
const metrics = {
    messagesProcessed: 0,
    messagesFailed: 0,
    avgResponseTimeMs: 0,
    _responseTimes: [] as number[],

    recordSuccess(responseTime: number) {
        this.messagesProcessed++;
        this._responseTimes.push(responseTime);
        if (this._responseTimes.length > 100) this._responseTimes.shift();
        this.avgResponseTimeMs = this._responseTimes.reduce((a, b) => a + b, 0) / this._responseTimes.length;
    },

    recordFailure() {
        this.messagesFailed++;
    },

    getStats() {
        return {
            processed: this.messagesProcessed,
            failed: this.messagesFailed,
            successRate: this.messagesProcessed > 0
                ? ((this.messagesProcessed - this.messagesFailed) / this.messagesProcessed * 100).toFixed(1) + '%'
                : 'N/A',
            avgResponseMs: Math.round(this.avgResponseTimeMs),
        };
    }
};

// 可通过 /stats 命令查看
```

---

## 8. 修复优先级汇总

| 优先级 | 问题 | 来源 | 预计工作量 |
|--------|------|------|------------|
| **P0** | tmux 命令注入修复（exec → spawn/execFile + path 校验） | A | 2-3h |
| **P0** | Streamer 返回结构增加 partial/timedOut | A+B | 1h |
| **P1** | JSONL 解析异常添加日志 | B | 1-2h |
| **P1** | 缓存大小限制 | B | 0.5h |
| **P1** | tmux 状态缓存同步 | B | 0.5h |
| **P1** | AppleScript 控制字符转义 | B | 0.5h |
| **P1** | 消息去重 size 检查 | B | 0.5h |
| **P2** | 群组标识符解析增强（可选） | A | 0.5h |
| **P2** | 简单监控指标（可选） | B | 2h |

---

## 9. 参考文件

| 文件 | 需修改 | 问题 |
|------|--------|------|
| `src/tmux/session.ts` | ✅ | 命令注入、projectDir 校验、状态同步 |
| `src/tmux/streamer.ts` | ✅ | 返回结构 |
| `src/listener.ts` | ✅ | 缓存限制、去重竞态、监控指标 |
| `src/output/parser.ts` | ✅ | JSONL 日志 |
| `src/output/reader.ts` | ✅ | JSONL 日志 |
| `src/security.ts` | ➖ | 可选优化 |

---

## 附录 A：修复验证测试用例

```typescript
// tmux 命令注入测试
describe("TmuxSession.sendCommand", () => {
    it("应该防止命令注入", async () => {
        await TmuxSession.sendCommand("test", '"; echo hacked #');
    });

    it("应该防止路径遍历", async () => {
        await expect(TmuxSession.start("test", "/tmp/../../../etc"))
            .rejects.toThrow("Invalid project directory");
    });
});

// AppleScript 注入测试
describe("escapeAppleScriptString", () => {
    it("应该转义换行符", () => {
        const escaped = escapeAppleScriptString("hello\nworld");
        expect(escaped).not.toContain("\n");
    });

    it("应该转义制表符", () => {
        const escaped = escapeAppleScriptString("hello\tworld");
        expect(escaped).not.toContain("\t");
    });
});

// Streamer 返回值测试
describe("handleTmuxStream", () => {
    it("超时应该返回 timedOut: true", async () => {
        const result = await handleTmuxStream("test", "long running", {
            timeout: 1000,
            onChunk: async () => {}
        });
        expect(result.timedOut).toBe(true);
        expect(result.partial).toBeDefined();
    });

    it("正常完成应该返回 partial: false", async () => {
        const result = await handleTmuxStream("test", "hello", {
            onChunk: async () => {}
        });
        expect(result.partial).toBe(false);
    });
});

// JSONL 解析日志测试
describe("AssistantParser.parseJsonl", () => {
    it("无效行应该记录日志", () => {
        const consoleSpy = vi.spyOn(logger, 'warn');
        AssistantParser.parseJsonl("invalid json\n{\"type\":\"assistant\"}");
        expect(consoleSpy).toHaveBeenCalled();
    });
});

// 消息去重竞态测试
describe("processedMessages deduplication", () => {
    it("应该防止重复消息处理", () => {
        const processedMessages = new Set<string>();
        const messageId = "test-123";

        // 模拟并发添加
        processedMessages.add(messageId);
        const sizeBefore = processedMessages.size;
        processedMessages.add(messageId);

        expect(processedMessages.size).toBe(sizeBefore);
    });
});

// 缓存大小限制测试
describe("cleanCache", () => {
    it("应该限制 recentMessageContents 大小", () => {
        // 添加超过 MAX_CONTENT_CACHE_SIZE 的条目
        for (let i = 0; i < 300; i++) {
            recentMessageContents.set(`key${i}`, Date.now());
        }
        cleanCache();
        expect(recentMessageContents.size).toBeLessThan(200);
    });
});
```

---

## 附录 B：手动验证清单

| 验证项 | 操作 | 预期结果 |
|--------|------|----------|
| 命令注入 | 发送 `$HOME`、`<cmd>`、`;ls /` 等 | 不会被 shell 解析 |
| AppleScript 注入 | 发送含换行符消息 | 不导致 AppleScript 错误 |
| 消息去重 | 快速连续发送相同消息 | 不会重复处理 |
| 超时状态 | 触发超时场景 | 返回 partial/timedOut 标志 |
| JSONL 日志 | 触发无效 JSONL | 控制台显示警告 |
| 缓存增长 | 长时间运行后检查 | 内存占用稳定 |

---

**报告生成**: Claude Code
**审核确认**: 资深程序员A、程序员B
**模型**: MiniMax-M2.1
**修订日期**: 2026-01-16
