/**
 * msgcode: P5.6.13-R2 线程存储回归锁
 *
 * 验收口径：
 * 1. 首轮消息自动创建线程文件
 * 2. 连续两轮写入同一线程文件并 turn 递增
 * 3. /clear 后新建线程文件
 * 4. 同名标题自动后缀去重
 * 5. workspace 切换后写入各自 .msgcode/threads
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ensureThread, appendTurn, resetThread, getThreadInfo } from "../src/runtime/thread-store.js";

// ============================================
// 测试工具
// ============================================

async function createTestWorkspace(): Promise<string> {
    const tmpDir = await fs.mkdtemp(path.join("/tmp", "msgcode-thread-test-"));
    return tmpDir;
}

async function cleanupTestWorkspace(workspacePath: string): Promise<void> {
    await fs.rm(workspacePath, { recursive: true, force: true });
}

async function readThreadFile(filePath: string): Promise<string> {
    return await fs.readFile(filePath, "utf-8");
}

function listThreads(workspacePath: string): Promise<string[]> {
    const threadsDir = path.join(workspacePath, ".msgcode", "threads");
    return fs.readdir(threadsDir);
}

// ============================================
// 测试用例
// ============================================

describe("P5.6.13-R2: 线程存储回归锁", () => {
    let workspacePath: string;
    let chatId: string;

    beforeEach(async () => {
        workspacePath = await createTestWorkspace();
        chatId = `test-chat-${randomUUID()}`;
    });

    afterEach(async () => {
        await cleanupTestWorkspace(workspacePath);
    });

    describe("R2-1: 线程创建", () => {
        it("首轮消息自动创建线程文件", async () => {
            const runtimeMeta = {
                kind: "agent" as const,
                provider: "lmstudio",
                tmuxClient: undefined,
            };

            const firstUserText = "你好，我是 Jerry";
            const threadInfo = await ensureThread(chatId, workspacePath, firstUserText, runtimeMeta);

            // 验证线程信息
            expect(threadInfo.threadId).toMatch(/^[0-9a-f-]+$/);
            expect(threadInfo.chatId).toBe(chatId);
            expect(threadInfo.workspacePath).toBe(workspacePath);
            expect(threadInfo.filePath).toContain(".msgcode/threads");
            expect(threadInfo.turnCount).toBe(0);

            // 验证文件存在
            try {
                await fs.access(threadInfo.filePath);
            } catch {
                throw new Error(`Thread file does not exist: ${threadInfo.filePath}`);
            }

            // 验证文件内容包含 front matter
            const content = await readThreadFile(threadInfo.filePath);
            expect(content).toContain("---");
            expect(content).toContain(`threadId: ${threadInfo.threadId}`);
            expect(content).toContain(`chatId: ${chatId}`);
            expect(content).toContain("runtimeKind: agent");
            expect(content).toContain("agentProvider: lmstudio");
        });

        it("标题清洗：保留原始标题，仅清洗非法字符", async () => {
            const runtimeMeta = {
                kind: "agent" as const,
                provider: "lmstudio",
                tmuxClient: undefined,
            };

            // 包含非法字符的标题
            const firstUserText = "你好 <世界>：测试/文件?.md";
            const threadInfo = await ensureThread(chatId, workspacePath, firstUserText, runtimeMeta);

            // 验证文件名不包含非法字符
            const filename = path.basename(threadInfo.filePath);
            expect(filename).not.toMatch(/[<>:"|?*]/);
        });

        it("标题裁剪：超过 24 字符自动裁剪", async () => {
            const runtimeMeta = {
                kind: "agent" as const,
                provider: "lmstudio",
                tmuxClient: undefined,
            };

            const firstUserText = "这是一个非常非常非常非常非常非常非常长的标题";
            const threadInfo = await ensureThread(chatId, workspacePath, firstUserText, runtimeMeta);

            const filename = path.basename(threadInfo.filePath);
            // 文件名格式：YYYY-MM-DD_<title>.md
            const titlePart = filename.replace(/^\d{4}-\d{2}-\d{2}_/, "").replace(/\.md$/, "");
            expect(titlePart.length).toBeLessThanOrEqual(24);
        });

        it("标题为空时回退为 untitled", async () => {
            const runtimeMeta = {
                kind: "agent" as const,
                provider: "lmstudio",
                tmuxClient: undefined,
            };

            const firstUserText = "   ";  // 只有空白
            const threadInfo = await ensureThread(chatId, workspacePath, firstUserText, runtimeMeta);

            const filename = path.basename(threadInfo.filePath);
            expect(filename).toMatch(/^\d{4}-\d{2}-\d{2}_untitled\.md$/);
        });
    });

    describe("R2-2: turn 递增", () => {
        it("连续两轮写入同一线程文件并 turn 递增", async () => {
            const runtimeMeta = {
                kind: "agent" as const,
                provider: "lmstudio",
                tmuxClient: undefined,
            };

            // 第一轮
            await ensureThread(chatId, workspacePath, "你好", runtimeMeta);
            await appendTurn(chatId, "你好", "你好！有什么可以帮你？");

            let threadInfo = getThreadInfo(chatId);
            expect(threadInfo?.turnCount).toBe(1);

            // 第二轮
            await appendTurn(chatId, "帮我写个函数", "好的，我来帮你写一个函数...");

            threadInfo = getThreadInfo(chatId);
            expect(threadInfo?.turnCount).toBe(2);

            // 验证文件内容
            const content = await readThreadFile(threadInfo!.filePath);

            // 应该包含两个 turn
            expect(content).toContain("## Turn 1");
            expect(content).toContain("## Turn 2");
            expect(content).toContain("### User\n你好");
            expect(content).toContain("### Assistant\n你好！有什么可以帮你？");
            expect(content).toContain("### User\n帮我写个函数");
            expect(content).toContain("### Assistant\n好的，我来帮你写一个函数...");
        });
    });

    describe("R2-3: /clear 轮转", () => {
        it("/clear 后新建线程文件", async () => {
            const runtimeMeta = {
                kind: "agent" as const,
                provider: "lmstudio",
                tmuxClient: undefined,
            };

            // 第一轮
            const threadInfo1 = await ensureThread(chatId, workspacePath, "你好", runtimeMeta);
            await appendTurn(chatId, "你好", "你好！");

            // 模拟 /clear
            await resetThread(chatId);

            // 验证缓存已清空
            expect(getThreadInfo(chatId)).toBeUndefined();

            // 第二轮（/clear 后）
            const threadInfo2 = await ensureThread(chatId, workspacePath, "新话题", runtimeMeta);

            // 应该是不同的线程文件
            expect(threadInfo2.threadId).not.toBe(threadInfo1.threadId);
            expect(threadInfo2.filePath).not.toBe(threadInfo1.filePath);

            // 验证有两个线程文件
            const files = await listThreads(workspacePath);
            expect(files.length).toBe(2);
        });
    });

    describe("R2-4: 重名去重", () => {
        it("同名标题自动后缀去重", async () => {
            const runtimeMeta = {
                kind: "agent" as const,
                provider: "lmstudio",
                tmuxClient: undefined,
            };

            // 第一次创建
            const threadInfo1 = await ensureThread(chatId, workspacePath, "测试标题", runtimeMeta);

            // 模拟 /clear
            await resetThread(chatId);

            // 第二次创建（同一天，同一标题）
            const threadInfo2 = await ensureThread(chatId, workspacePath, "测试标题", runtimeMeta);

            // 验证文件名不同
            const filename1 = path.basename(threadInfo1.filePath);
            const filename2 = path.basename(threadInfo2.filePath);

            // 验证文件名格式（使用包含检查）
            expect(filename1).toContain('测试标题');
            expect(filename1).toMatch(/^\d{4}-\d{2}-\d{2}_/);
            expect(filename1).toMatch(/\.md$/);
            expect(filename2).toContain('测试标题');
            expect(filename2).toMatch(/-2\.md$/);

            // 第三次创建
            await resetThread(chatId);
            const threadInfo3 = await ensureThread(chatId, workspacePath, "测试标题", runtimeMeta);
            const filename3 = path.basename(threadInfo3.filePath);
            expect(filename3).toContain('测试标题');
            expect(filename3).toMatch(/-3\.md$/);
        });
    });

    describe("R2-5: workspace 隔离", () => {
        it("workspace 切换后写入各自 .msgcode/threads", async () => {
            const workspace1 = await createTestWorkspace();
            const workspace2 = await createTestWorkspace();
            const chatId1 = `chat-${randomUUID()}`;
            const chatId2 = `chat-${randomUUID()}`;

            const runtimeMeta = {
                kind: "agent" as const,
                provider: "lmstudio",
                tmuxClient: undefined,
            };

            try {
                // workspace1 创建线程
                const threadInfo1 = await ensureThread(chatId1, workspace1, "你好", runtimeMeta);

                // workspace2 创建线程
                const threadInfo2 = await ensureThread(chatId2, workspace2, "你好", runtimeMeta);

                // 验证文件在各自的 workspace 中
                expect(threadInfo1.filePath).toContain(workspace1);
                expect(threadInfo2.filePath).toContain(workspace2);

                // 验证目录结构
                const threads1 = await listThreads(workspace1);
                const threads2 = await listThreads(workspace2);

                expect(threads1.length).toBe(1);
                expect(threads2.length).toBe(1);
            } finally {
                await cleanupTestWorkspace(workspace1);
                await cleanupTestWorkspace(workspace2);
            }
        });
    });

    describe("R2-6: front matter 结构", () => {
        it("front matter 包含所有必填字段", async () => {
            const runtimeMeta = {
                kind: "agent" as const,
                provider: "lmstudio",
                tmuxClient: undefined,
            };

            const threadInfo = await ensureThread(chatId, workspacePath, "测试", runtimeMeta);
            const content = await readThreadFile(threadInfo.filePath);

            // 验证必填字段
            expect(content).toMatch(/threadId:\s*[0-9a-f-]+/);
            expect(content).toMatch(/chatId:\s*.+/);
            expect(content).toMatch(/workspace:\s*.+/);
            expect(content).toMatch(/workspacePath:\s*.+/);
            expect(content).toMatch(/createdAt:\s*\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
            expect(content).toMatch(/runtimeKind:\s*(agent|tmux)/);
            expect(content).toMatch(/agentProvider:\s*.+/);
        });

        it("tmux 模式包含 tmuxClient 字段", async () => {
            const runtimeMeta = {
                kind: "tmux" as const,
                provider: "codex",
                tmuxClient: "claude-code",
            };

            const threadInfo = await ensureThread(chatId, workspacePath, "测试", runtimeMeta);
            const content = await readThreadFile(threadInfo.filePath);

            expect(content).toContain("runtimeKind: tmux");
            expect(content).toContain("agentProvider: codex");
            expect(content).toContain("tmuxClient: claude-code");
        });
    });

    describe("R2-7: 错误处理", () => {
        it("appendTurn 在 ensureThread 之前调用不抛错", async () => {
            // 没有调用 ensureThread 直接调用 appendTurn
            await expect(appendTurn(chatId, "你好", "你好")).resolves.toBeUndefined();
        });

        it("getThreadInfo 返回 undefined 当线程不存在", async () => {
            expect(getThreadInfo("non-existent-chat")).toBeUndefined();
        });
    });
});
