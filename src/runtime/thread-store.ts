/**
 * msgcode: Thread Store - Workspace 对话落盘
 *
 * P5.6.13-R2: 每个 workspace 在 .msgcode/threads/ 自动落盘会话
 * - 一线程一 Markdown 文件
 * - 支持 turn 追加
 * - /clear 后开启新线程文件
 */

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { logger } from "../logger/index.js";

// ============================================
// 类型定义
// ============================================

export interface ThreadInfo {
    threadId: string;      // UUID
    chatId: string;
    workspacePath: string;
    filePath: string;      // 绝对路径
    turnCount: number;
    createdAt: string;     // ISO 字符串
}

export interface RuntimeMeta {
    kind: "agent" | "tmux";
    provider: string;
    tmuxClient?: string;
}

interface ThreadState {
    info: ThreadInfo;
    lastTurnTime: string;
}

// ============================================
// 内存状态（进程级缓存）
// ============================================

// chatId → ThreadState 映射
const threadCache = new Map<string, ThreadState>();

// ============================================
// 工具函数
// ============================================

/**
 * 清洗标题：保留原始标题，仅清洗非法文件名字符
 * - 删除非法字符：< > : " / \ | ? *
 * - 裁剪前后空白
 * - 长度限制：最多 24 个可见字符
 */
function sanitizeTitle(title: string): string {
    // 裁剪空白
    let sanitized = title.trim();

    // 长度限制：最多 24 个可见字符
    if (sanitized.length > 24) {
        sanitized = sanitized.slice(0, 24).trim();
    }

    // 删除非法文件名字符
    sanitized = sanitized.replace(/[<>:"/\\|?*]/g, "");

    // 再次裁剪空白（删除非法字符后可能产生新的前后空白）
    sanitized = sanitized.trim();

    // 如果清洗后为空，回退为 untitled
    return sanitized || "untitled";
}

/**
 * 生成唯一文件名：处理同日重名情况
 * - 基础格式：<YYYY-MM-DD>_<title>.md
 * - 重名后缀：-2/-3/-4...
 */
async function generateUniqueFilename(
    threadsDir: string,
    datePrefix: string,
    title: string
): Promise<string> {
    const baseName = `${datePrefix}_${title}`;
    const ext = ".md";

    // 先尝试基础名称
    const candidate = `${baseName}${ext}`;
    const fullPath = path.join(threadsDir, candidate);

    try {
        await fs.access(fullPath);
        // 文件已存在，需要添加后缀
    } catch {
        // 文件不存在，可以直接使用
        return candidate;
    }

    // 文件已存在，尝试 -2, -3, -4...
    let suffix = 2;
    while (true) {
        const candidateWithSuffix = `${baseName}-${suffix}${ext}`;
        const fullPathWithSuffix = path.join(threadsDir, candidateWithSuffix);

        try {
            await fs.access(fullPathWithSuffix);
            suffix++;
        } catch {
            return candidateWithSuffix;
        }
    }
}

/**
 * 获取 threads 目录路径
 */
function getThreadsDir(workspacePath: string): string {
    return path.join(workspacePath, ".msgcode", "threads");
}

/**
 * 构建 front matter
 */
function buildFrontMatter(
    threadInfo: ThreadInfo,
    runtimeMeta: RuntimeMeta
): string {
    const lines = [
        "---",
        `threadId: ${threadInfo.threadId}`,
        `chatId: ${threadInfo.chatId}`,
        `workspace: ${path.basename(threadInfo.workspacePath)}`,
        `workspacePath: ${threadInfo.workspacePath}`,
        `createdAt: ${threadInfo.createdAt}`,
        `runtimeKind: ${runtimeMeta.kind}`,
        `agentProvider: ${runtimeMeta.provider}`,
    ];

    if (runtimeMeta.tmuxClient) {
        lines.push(`tmuxClient: ${runtimeMeta.tmuxClient}`);
    } else if (runtimeMeta.kind === "agent") {
        lines.push("tmuxClient: none");
    }

    lines.push("---");

    return lines.join("\n");
}

/**
 * 格式化 turn 标题
 */
function formatTurnHeader(turnNumber: number, timestamp: Date): string {
    const isoString = timestamp.toISOString();
    return `## Turn ${turnNumber} - ${isoString}`;
}

// ============================================
// 核心 API
// ============================================

/**
 * 确保线程存在（首次消息或 /clear 后调用）
 *
 * @param chatId - 会话 ID
 * @param workspacePath - Workspace 绝对路径
 * @param firstUserText - 首条用户消息（用于生成标题）
 * @param runtimeMeta - 运行时元信息
 * @returns ThreadInfo
 */
export async function ensureThread(
    chatId: string,
    workspacePath: string,
    firstUserText: string,
    runtimeMeta: RuntimeMeta
): Promise<ThreadInfo> {
    const started = Date.now();

    // 检查缓存
    const cached = threadCache.get(chatId);
    if (cached) {
        logger.debug("Thread already exists in cache", {
            module: "thread-store",
            chatId,
            threadId: cached.info.threadId,
        });
        return cached.info;
    }

    // 创建 threads 目录
    const threadsDir = getThreadsDir(workspacePath);
    await fs.mkdir(threadsDir, { recursive: true });

    // 生成标题
    const title = sanitizeTitle(firstUserText);
    const datePrefix = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    // 生成唯一文件名
    const filename = await generateUniqueFilename(threadsDir, datePrefix, title);
    const filePath = path.join(threadsDir, filename);

    // 构建 ThreadInfo
    const threadInfo: ThreadInfo = {
        threadId: randomUUID(),
        chatId,
        workspacePath,
        filePath,
        turnCount: 0,
        createdAt: new Date().toISOString(),
    };

    // 写入 front matter
    const frontMatter = buildFrontMatter(threadInfo, runtimeMeta);
    const content = `${frontMatter}\n\n`;

    await fs.writeFile(filePath, content, { encoding: "utf-8" });

    // 更新缓存
    threadCache.set(chatId, {
        info: threadInfo,
        lastTurnTime: new Date().toISOString(),
    });

    logger.info("Thread created", {
        module: "thread-store",
        chatId,
        threadId: threadInfo.threadId,
        threadPath: filePath,
        threadTitle: title,
        durationMs: Date.now() - started,
    });

    return threadInfo;
}

/**
 * 追加一轮对话（用户消息 + 助手回答）
 *
 * @param chatId - 会话 ID
 * @param userText - 用户消息
 * @param assistantText - 助手回答
 * @param timestamp - 时间戳（可选，默认当前时间）
 */
export async function appendTurn(
    chatId: string,
    userText: string,
    assistantText: string,
    timestamp?: Date
): Promise<void> {
    const state = threadCache.get(chatId);
    if (!state) {
        logger.warn("appendTurn called without ensureThread first", {
            module: "thread-store",
            chatId,
        });
        return;
    }

    const started = Date.now();
    const turnTime = timestamp ?? new Date();
    const turnNumber = ++state.info.turnCount;
    state.lastTurnTime = turnTime.toISOString();

    // 格式化 turn 内容
    const turnHeader = formatTurnHeader(turnNumber, turnTime);
    const turnContent = `${turnHeader}\n\n### User\n${userText}\n\n### Assistant\n${assistantText}\n\n`;

    try {
        // 追加到文件末尾
        await fs.appendFile(state.info.filePath, turnContent, { encoding: "utf-8" });

        logger.debug("Turn appended", {
            module: "thread-store",
            chatId,
            threadId: state.info.threadId,
            threadTurn: turnNumber,
            threadPersistMs: Date.now() - started,
        });
    } catch (error) {
        // 写入失败只记日志，不中断主链路
        logger.error("Failed to append turn", {
            module: "thread-store",
            chatId,
            threadId: state.info.threadId,
            threadTurn: turnNumber,
            threadPersistError: error instanceof Error ? error.message : String(error),
            durationMs: Date.now() - started,
        });
    }
}

/**
 * 重置线程（/clear 后调用，创建新线程）
 *
 * @param chatId - 会话 ID
 */
export async function resetThread(chatId: string): Promise<void> {
    // 从缓存中删除，下次消息会创建新线程
    threadCache.delete(chatId);

    logger.info("Thread reset (cache cleared, new thread will be created on next message)", {
        module: "thread-store",
        chatId,
    });
}

/**
 * 获取当前线程信息（用于观测和调试）
 */
export function getThreadInfo(chatId: string): ThreadInfo | undefined {
    return threadCache.get(chatId)?.info;
}

/**
 * 关闭 thread-store（清理缓存，用于进程关闭时）
 */
export function close(): void {
    threadCache.clear();
    logger.debug("Thread store cache cleared", {
        module: "thread-store",
    });
}
