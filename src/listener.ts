/**
 * msgcode: 消息监听器
 *
 * 监听 iMessage 消息，路由到对应处理器，并发送回复
 */

import type { IMessageSDK } from "@photon-ai/imessage-kit";
import type { Message } from "@photon-ai/imessage-kit";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";

const execAsync = promisify(exec);

import { checkWhitelist, formatSender } from "./security.js";
import { routeByChatId, isConfiguredChatId, getAllRoutes, type Route, type BotType } from "./router.js";
import { getHandler, type HandleResult } from "./handlers.js";
import { createWatcher, isFileWatchingAvailable, type DatabaseWatcher } from "./watcher.js";
import { handleTmuxStream } from "./tmux/streamer.js";
import { logger } from "./logger/index.js";
import { config } from "./config.js";
import { TmuxSession } from "./tmux/session.js";

/**
 * 消息监听器配置
 */
export interface ListenerConfig {
    sdk: IMessageSDK;
    debug?: boolean;
}

/**
 * 已处理消息缓存（防止重复处理）
 */
const processedMessages = new Set<string>();
const MAX_CACHE_SIZE = 1000;
const handledMessages = new Map<string, number>(); // messageId -> timestamp
const HANDLED_TTL = 5 * 60 * 1000; // 5分钟内视为已处理
const inFlightMessages = new Set<string>();
let hasAnnouncedStartup = false;
const UNKNOWN_CHAT_RATE_LIMIT_WINDOW = 60000; // 60秒
const UNKNOWN_CHAT_MAX_HITS = 3;
const unknownChatHits = new Map<string, { count: number; first: number }>();
const unknownChatWarnCooldown = new Map<string, number>(); // chatId -> last warn timestamp
const UNKNOWN_WARN_COOLDOWN = 60000; // 60秒节流未知群告警
const groupIdWarned = new Set<string>(); // 启动校验发现的异常群组
const rateLimitMap = new Map<string, { tokens: number; last: number }>();
const RATE_LIMIT_WINDOW = 1000; // 1秒窗口
const RATE_LIMIT_TOKENS = 3; // 每秒最多3条
let healthTimer: ReturnType<typeof setInterval> | null = null;
const HEALTH_INTERVAL = 60000; // 60 秒健康检查
const markReadFailures = new Map<string, number>(); // chatId -> 连续失败次数

/**
 * AppleScript 检查 chatId 是否存在
 */
async function checkChatExistsAppleScript(chatId: string): Promise<boolean> {
    const escaped = chatId.replace(/"/g, '\\"');
    const script = `
        tell application "Messages"
            if exists chat id "${escaped}" then
                return "ok"
            else
                return "missing"
            end if
        end tell
    `.trim();
    try {
        const { stdout } = await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: 5000 });
        return stdout.trim() === "ok";
    } catch {
        return false;
    }
}

/**
 * 启动时校验群组 chatId 是否可用（只对群聊）
 */
async function verifyConfiguredChats(): Promise<void> {
    const routes = getAllRoutes();
    const invalid: string[] = [];

    for (const route of routes) {
        const chatId = route.chatId;
        const isGroupChat = /^[a-f0-9]{32}$/i.test(chatId) || chatId.startsWith("any;+;");
        if (!isGroupChat) continue;

        const ok = await checkChatExistsAppleScript(chatId);
        if (!ok) {
            const key = `${route.groupName}:${chatId}`;
            if (!groupIdWarned.has(key)) {
                groupIdWarned.add(key);
                logger.warn(`⚠️ 群组 chatId 不存在或未加入: ${chatId}`, { module: "listener", groupName: route.groupName });
            }
            invalid.push(`${route.groupName}(${chatId})`);
        }
    }

    if (invalid.length > 0) {
        logger.warn(`⚠️ 群组校验失败，无法发送: ${invalid.join(", ")}`, { module: "listener" });
    } else {
        logger.info("✅ 群组 chatId 校验通过", { module: "listener" });
    }
}

/**
 * 心跳/自愈机制（防止 SDK Watcher 静默停摆）
 */
let lastActivity = Date.now(); // 最后活动时间戳
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
const HEARTBEAT_CHECK_INTERVAL = 15000; // 守护检查间隔：15秒
const HEARTBEAT_ACTIVITY_TIMEOUT = 60000; // 活动超时阈值：60秒（避免误报）

/**
 * 最近处理的消息内容（基于文本的去重，防止相同内容的不同消息 id）
 * Key: "chatId:text", Value: timestamp
 */
const recentMessageContents = new Map<string, number>();
const CONTENT_DEDUP_WINDOW = 10000; // 10秒内相同文本视为重复
const CONTENT_DEDUP_IMMEDIATE_WINDOW = 1000; // 1秒内的重复视为系统重复检测（SDK Watcher + polling）

/**
 * 消息处理队列（每个 chatId 一个队列，确保顺序处理）
 */
const processingQueues = new Map<string, {
    promise: Promise<void>;
    startTime: number;
    version: number;  // 版本号，用于检测重置
}>();

/**
 * 队列处理超时时间（毫秒）
 */
const QUEUE_TIMEOUT = 360000; // 6 分钟（比 streamer 的 5 分钟多 1 分钟缓冲）

/**
 * 带超时的 Promise 包装
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMsg: string): Promise<T> {
    return Promise.race([
        promise,
        new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(errorMsg)), timeoutMs)
        ),
    ]);
}

/**
 * 延时函数
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 更新心跳时间戳（每次处理消息时调用）
 */
function updateHeartbeat(): void {
    lastActivity = Date.now();
}

/**
 * 启动心跳守护进程（检测 SDK Watcher 静默停摆）
 */
function startHeartbeatMonitor(
    sdk: IMessageSDK,
    debug: boolean,
    handler: (message: Message) => Promise<void>
): void {
    if (heartbeatTimer) {
        logger.warn("⚠️  心跳监控已在运行", { module: "listener" });
        return;
    }

    logger.info("💓 启动心跳监控", { module: "listener", checkInterval: HEARTBEAT_CHECK_INTERVAL, activityTimeout: HEARTBEAT_ACTIVITY_TIMEOUT });

    heartbeatTimer = setInterval(async () => {
        const now = Date.now();
        const inactiveTime = now - lastActivity;

        // 检查是否有正在处理的队列（避免误报）
        const hasInFlight = processingQueues.size > 0 || inFlightMessages.size > 0;

        // 检查是否超时（只有在没有正在处理的消息时才报停摆）
        if (inactiveTime > HEARTBEAT_ACTIVITY_TIMEOUT && !hasInFlight) {
            logger.warn(`⚠️  检测到 SDK Watcher 停摆 (${Math.floor(inactiveTime / 1000)}s 无活动)，开始自愈`, {
                module: "listener",
                inactiveTime,
                lastActivity: new Date(lastActivity).toISOString()
            });

            console.log(`⚠️  检测到服务停摆 (${Math.floor(inactiveTime / 1000)}s 无活动)，正在自愈...`);

            try {
                // 1. 立即检查未读消息
                await checkExistingMessages(sdk, debug, handler);

                // 2. 更新心跳时间（避免重复触发）
                updateHeartbeat();

                logger.info("✅ 心跳自愈完成", { module: "listener" });
                console.log("✅ 服务已恢复");
            } catch (error: any) {
                logger.error(`❌ 心跳自愈失败: ${error.message}`, { module: "listener", error });
                console.error("❌ 自愈失败，将在下次检查时重试");
            }
        }
    }, HEARTBEAT_CHECK_INTERVAL);
}

/**
 * 停止心跳监控
 */
function stopHeartbeatMonitor(): void {
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
        logger.info("💓 心跳监控已停止", { module: "listener" });
    }
}

/**
 * 将消息处理加入队列（确保每个 chatId 同时只处理一条消息）
 */
async function enqueueMessage(chatId: string, handler: () => Promise<void>): Promise<void> {
    let existing = processingQueues.get(chatId);

    // 检查上一条消息是否超时
    if (existing) {
        const elapsed = Date.now() - existing.startTime;
        if (elapsed > QUEUE_TIMEOUT) {
            logger.warn(`⚠️  [${chatId}] 队列超时 (${elapsed}ms)，强制重置`, { module: "listener", chatId, elapsed });
            // 直接删除超时的队列条目，避免重复检测
            processingQueues.delete(chatId);
            existing = undefined;  // 清除引用，避免链式调用
        }
    }

    const nextVersion = existing ? existing.version + 1 : 1;

    const wrappedHandler = async () => {
        const startTime = Date.now();
        let handlerError: Error | null = null;
        try {
            await withTimeout(handler(), QUEUE_TIMEOUT, `消息处理超时 (${QUEUE_TIMEOUT}ms)`);
        } catch (error: any) {
            const normalizedError = error instanceof Error ? error : new Error(String(error));
            handlerError = normalizedError;
            // 记录错误但继续处理后续消息
            logger.error(`❌ [${chatId}] 处理失败: ${normalizedError.message}`, { module: "listener", chatId, error: normalizedError });
            if (normalizedError.message.includes('超时')) {
                logger.error(`   可能原因: Claude 响应过慢或 tmux 会话卡死`, { module: "listener", chatId });
            }
        } finally {
            const elapsed = Date.now() - startTime;
            if (elapsed > 10000) {  // 超过 10 秒记录
                logger.info(`⏱️  [${chatId}] 处理耗时: ${elapsed}ms`, { module: "listener", chatId, elapsed });
            }
        }
        if (handlerError) {
            throw handlerError;
        }
    };

    const nextPromise = existing
        ? existing.promise.then(wrappedHandler, wrappedHandler)
        : wrappedHandler();

    processingQueues.set(chatId, { promise: nextPromise, startTime: Date.now(), version: nextVersion });

    try {
        await nextPromise;
    } finally {
        // 只有当前版本匹配时才清理（防止旧 Promise 清理新队列）
        const current = processingQueues.get(chatId);
        if (current && current.version === nextVersion) {
            processingQueues.delete(chatId);
        }
    }
}

/**
 * 已发送回复缓存（防止重复发送）
 * 格式：Map<chatId, { text: string, timestamp: number }>
 */
const sentReplies = new Map<string, { text: string; timestamp: number }>();
const REPLY_COOLDOWN = 10000; // 10秒内不重复发送相同回复

/**
 * 失败重试计数器（轻量级）
 */
const retryAttempts = new Map<string, number>();
const MAX_RETRIES = 2; // 最多重试 2 次
const RETRY_DELAY = 1000; // 1 秒退避

/**
 * 清理旧缓存
 */
function cleanCache() {
    if (processedMessages.size > MAX_CACHE_SIZE) {
        const entries = Array.from(processedMessages);
        for (let i = 0; i < entries.length / 2; i++) {
            processedMessages.delete(entries[i]);
        }
    }

    // 清理已处理消息的 TTL 缓存
    const now = Date.now();
    for (const [id, ts] of handledMessages.entries()) {
        if (now - ts > HANDLED_TTL) {
            handledMessages.delete(id);
        }
    }
}

/**
 * 健康检查（轻量）
 */
async function healthCheck(sdk: IMessageSDK): Promise<void> {
    try {
        // 检查 Claude 会话是否存活（tmux）
        const exists = await TmuxSession.exists("health-check");
        const chatDb = `${os.homedir()}/Library/Messages/chat.db`;
        const dbExists = fs.existsSync(chatDb);
        logger.info("🩺 healthz", { module: "listener", tmuxExists: exists, dbExists });
    } catch (error: any) {
        logger.error(`❌ healthz 检查失败: ${error.message}`, { module: "listener", error });
    }
}

function startHealthMonitor(sdk: IMessageSDK): void {
    if (healthTimer) return;
    healthTimer = setInterval(() => {
        healthCheck(sdk).catch(() => {});
    }, HEALTH_INTERVAL);
    logger.info("🩺 健康检查已启动", { module: "listener", interval: HEALTH_INTERVAL });
}

function stopHealthMonitor(): void {
    if (healthTimer) {
        clearInterval(healthTimer);
        healthTimer = null;
        logger.info("🩺 健康检查已停止", { module: "listener" });
    }
}

/**
 * 上线通知（配置开关控制，失败不重试）
 */
async function sendStartupAnnouncement(sdk: IMessageSDK): Promise<void> {
    if (hasAnnouncedStartup) return;

    // 检查配置开关
    if (!config.sendStartupAnnouncement) {
        logger.info("🔇 上线通知已禁用（SEND_STARTUP_ANNOUNCEMENT=false）", { module: "listener" });
        hasAnnouncedStartup = true;
        return;
    }

    const routes = getAllRoutes();
    if (routes.length === 0) {
        logger.info("🎯 无群组配置，跳过上线通知", { module: "listener" });
        hasAnnouncedStartup = true;
        return;
    }

    const timestamp = new Date().toISOString().replace("T", " ").slice(0, 19);
    const text = config.announceMessage || `Hi ${timestamp}，已上线`;

    // 记录失败的群组（避免重复刷屏）
    const failedGroups = new Set<string>();

    for (const route of routes) {
        const chatId = route.chatId;
        const isGroupChat = /^[a-f0-9]{32}$/i.test(chatId) || chatId.startsWith("any;+;");
        const groupKey = `${route.groupName}:${chatId}`;

        try {
            // 启动前验证群聊是否存在（仅限群组）
            if (isGroupChat) {
                const exists = await checkChatExistsAppleScript(chatId);
                if (!exists) {
                    logger.warn(`⚠️ 群组 chatId 不存在或未加入: ${chatId}`, { module: "listener", groupName: route.groupName });
                    continue;
                }
            }
            if (isGroupChat) {
                await sendToChatGroup(chatId, text);
            } else {
                await sendToIndividual(sdk, chatId, text);
            }
            logger.info(`✅ 上线通知已发送`, { module: "listener", chatId, groupName: route.groupName });
        } catch (error: any) {
            // 只记录一次失败，避免刷屏
            if (!failedGroups.has(groupKey)) {
                failedGroups.add(groupKey);
                logger.warn(`⚠️ 上线通知发送失败（将不再重试）: ${error.message.slice(0, 60)}`, {
                    module: "listener",
                    chatId,
                    groupName: route.groupName,
                    hint: "如需关闭通知，设置 SEND_STARTUP_ANNOUNCEMENT=false"
                });
            }
        }
    }

    hasAnnouncedStartup = true;
}

/**
 * 判断是否需要流式处理
 *
 * @param route 路由信息
 * @param message 消息内容
 * @returns 是否使用流式处理
 */
function shouldStream(route: Route, message: string): boolean {
    // 命令消息不使用流式处理
    if (message.trim().startsWith("/")) {
        return false;
    }
    // 其他消息使用流式处理（转发给 Claude）
    return true;
}

/**
 * 启动时标记所有消息为已读（打开 Messages 应用一次）
 */
let hasOpenedMessages = false;
async function markMessagesAsReadOnStartup(): Promise<void> {
    if (hasOpenedMessages) return;
    hasOpenedMessages = true;
    try {
        // 打开 Messages 应用，自动同步已读状态
        await execAsync(`open -a Messages`, { timeout: 5000 });  // 添加超时
    } catch {
        // 忽略错误
    }
}

/**
 * iMessage 数据库路径
 */
const MESSAGES_DB_PATH = `${process.env.HOME}/Library/Messages/chat.db`;

/**
 * 转义 SQLite 字符串（防止注入）
 */
function escapeSqlString(str: string): string {
    return str.replace(/'/g, "''");
}

/**
 * AppleScript 降级标记已读
 */
async function markAsReadAppleScript(chatId: string): Promise<boolean> {
    const fullChatId = chatId.includes(";") ? chatId : `any;+;${chatId}`;
    try {
        await execAsync(`osascript -e 'tell application "Messages" to set read of chat id "${fullChatId}" to true' 2>/dev/null`, { timeout: 5000 });  // 添加超时
        return true;
    } catch {
        return false;
    }
}

/**
 * 使用 SQLite 直接标记消息为已读（带降级）
 *
 * AppleScript 无法标记 iMessage 为已读，直接操作数据库是唯一可靠方法
 * 失败时降级到 AppleScript（虽然不可靠，但聊胜于无）
 */
async function markAsReadSQLite(chatId: string): Promise<void> {
    // 确保使用完整格式 any;+;GUID
    const fullChatId = chatId.includes(";") ? chatId : `any;+;${chatId}`;
    const escapedChatId = escapeSqlString(fullChatId);
    const failureKey = fullChatId;
    const failures = (markReadFailures.get(failureKey) ?? 0);

    // SQLite UPDATE 命令（单行格式，避免引号问题）
    const sql = `UPDATE message SET is_read=1, date_read=(strftime('%s','now')+978307200)*1000000000 WHERE ROWID IN (SELECT cmj.message_id FROM chat_message_join cmj JOIN chat c ON cmj.chat_id=c.ROWID WHERE c.guid='${escapedChatId}') AND is_read=0`;

    try {
        await execAsync(`sqlite3 "${MESSAGES_DB_PATH}" "${sql}"`, { timeout: 5000 });
        markReadFailures.delete(failureKey);
    } catch (error: any) {
        // SQLite 失败时降级到 AppleScript
        const success = await markAsReadAppleScript(chatId);
        if (!success) {
            const nextFailures = failures + 1;
            markReadFailures.set(failureKey, nextFailures);
            logger.warn(`⚠️ markAsRead 完全失败(${nextFailures}): ${error.message.slice(0, 40)}...`, { module: "listener", error });
            if (nextFailures >= 3) {
                logger.error("🚨 无法标记已读，请打开 Messages 应用并保持前台同步", { module: "listener", chatId });
            }
        }
    }
}

/**
 * 转义 AppleScript 字符串
 */
function escapeAppleScriptString(str: string): string {
    return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * 发送到群组（使用 AppleScript，SDK 不支持群组）
 */
async function sendToChatGroup(chatId: string, text: string): Promise<void> {
    const fullChatId = chatId.includes(";") ? chatId : `any;+;${chatId}`;
    const escapedText = escapeAppleScriptString(text);
    const escapedChatId = escapeAppleScriptString(fullChatId);

    const script = `
tell application "Messages"
    set targetChat to chat id "${escapedChatId}"
    send "${escapedText}" to targetChat
end tell
`.trim();

    await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: 5000 });  // 添加超时
}

/**
 * 发送给个人（使用 SDK）
 */
async function sendToIndividual(sdk: IMessageSDK, chatId: string, text: string): Promise<void> {
    // chatId 格式: any;-;email@example.com
    const parts = chatId.split(";-;");
    const address = parts[1] || chatId;
    await sdk.send(address, text);
}

/**
 * 检查是否应该跳过该输出（过滤 plugin 等无关输出）
 */
function shouldSkipOutput(text: string): boolean {
    // 如果文本太长（超过1000字符），很可能是 plugin 输出
    if (text.length > 1000) {
        logger.info(`🚫 过滤长文本 (${text.length}字符): ${text.slice(0, 50)}...`, { module: "listener" });
        return true;
    }

    // 长度检查：大于 500 字符且包含特定关键词，也视为插件输出
    if (text.length > 500 && (
        text.includes("observation") ||
        text.includes("No code was written") ||
        text.includes("no technical work")
    )) {
        logger.info(`🚫 过滤长插件输出 (${text.length}字符)`, { module: "listener", preview: text.slice(0, 50) });
        return true;
    }

    // 过滤 plugin/MCP 观察者输出
    const skipPatterns = [
        /I understand the task\. I'm a.*observer/i,
        /No observation created/i,
        /However, I notice that the observed session/i,
        /According to my instructions:/i,
        /This appears to be a simple conversational exchange/i,
        /Claude-Mem observer/i,
        /MCP observer/i,
        // 新增：更多 Claude-Mem 插件输出模式
        /I notice that I'?m being asked to observe/i,
        /I notice that I'?m being asked/i,
        /the only content provided/i,
        /not a development or implementation task/i,
        /appears to be a simple question/i,
        /being asked to observe a session/i,
        // 过滤 XML observation/summary 块（匹配有或无尖括号前缀的情况）
        /<?(observation|summary)>/i,
        /<\/?(observation|summary)>/i,
        // 匹配数字前缀的 XML 块: "1observation>", "12summary>", "3summary>" 等
        /\d*<\/?(observation|summary)>/i,
        /\d*(observation|summary)>/i,
        // 匹配 XML 结构的元素
        /<type>.*(bugfix|feature|refactor|change|discovery).*<\/type>/i,
        /<(title|facts|narrative|concepts|request|investigated|learned|completed|next_steps|notes)>/i,
        /<\/(title|facts|narrative|concepts|request|investigated|learned|completed|next_steps|notes)>/i,
    ];

    for (const pattern of skipPatterns) {
        if (pattern.test(text)) {
            logger.info(`🚫 过滤输出，匹配模式: ${pattern.source}`, { module: "listener", textPreview: text.slice(0, 100) });
            return true;
        }
    }

    // 过滤看起来像元数据/日志的输出（包含特定标记）
    if (text.includes("**No observation created**") ||
        text.includes("When to skip") ||
        text.includes("deliverables and capabilities") ||
        text.includes("falls under routine operations") ||
        text.includes("should be skipped") ||
        text.includes("No observation will be generated") ||
        text.includes("WHEN TO SKIP category") ||
        text.includes("No code was written") ||
        text.includes("no files were modified") ||
        text.includes("no technical work")) {
        logger.info(`🚫 过滤元数据输出`, { module: "listener", preview: text.slice(0, 50) });
        return true;
    }

    return false;
}

/**
 * 发送回复
 */
async function sendReply(sdk: IMessageSDK, chatId: string, text: string): Promise<void> {
    try {
        // 过滤 plugin/MCP 等无关输出
        if (shouldSkipOutput(text)) {
            logger.info(`✅ 已跳过发送 (${text.length}字符)`, { module: "listener", chatId, preview: text.slice(0, 30) });
            return;
        }

        logger.info(`📤 准备发送回复 (${text.length}字符)`, { module: "listener", chatId, preview: text.slice(0, 30) });

        // 检查是否在冷却期内（防止短时间内重复发送相同回复）
        const now = Date.now();
        const lastReply = sentReplies.get(chatId);
        if (lastReply && lastReply.text === text) {
            const elapsed = now - lastReply.timestamp;
            if (elapsed < REPLY_COOLDOWN) {
                logger.info(`⏸️  冷却中跳过重复回复 (${elapsed}ms < ${REPLY_COOLDOWN}ms)`, { module: "listener", chatId, elapsed });
                return;
            }
            // 超过冷却期，允许发送
        }
        sentReplies.set(chatId, { text, timestamp: now });

        // 判断是群组还是个人
        // 群组 chatId 格式: 纯 GUID (32位十六进制) 或 any;+;GUID
        const isGroupChat = /^[a-f0-9]{32}$/i.test(chatId) || chatId.startsWith("any;+;");

        if (isGroupChat) {
            // 群组使用 AppleScript 发送（SDK 不支持群组）
            await sendToChatGroup(chatId, text);
        } else {
            // 个人使用 SDK 发送
            await sendToIndividual(sdk, chatId, text);
        }
    } catch (error: any) {
        logger.error(`❌ 发送失败: ${error.message}`, { module: "listener", chatId, error });
    }
}

/**
 * 处理收到的消息
 */
export async function handleMessage(
    message: Message,
    { sdk, debug }: ListenerConfig
): Promise<void> {
    // 跳过没有 id 的消息
    if (!message.id) {
        if (debug) logger.debug("🔍 跳过无 id 消息", { module: "listener" });
        return;
    }
    const messageId = message.id;

    // 5 分钟内已处理过，直接跳过（防止重复拉取/重启后重复）
    const handledAt = handledMessages.get(messageId);
    if (handledAt && Date.now() - handledAt < HANDLED_TTL) {
        if (debug) logger.debug(`🔁 已处理过，跳过: ${messageId}`, { module: "listener", messageId });
        return;
    }

    // 防止同一消息并发处理中
    if (inFlightMessages.has(messageId)) {
        if (debug) logger.debug(`⏳ 已在处理中的消息，跳过: ${messageId}`, { module: "listener", messageId });
        return;
    }

    // 🔒 高优先级：跳过自己发送的消息，防止自我回路
    if (message.isFromMe === true) {
        if (debug) logger.debug(`🔍 跳过自身消息: ${message.id} | ${message.text?.slice(0, 30)}`, { module: "listener", messageId: message.id });
        return;
    }

    // 防止重复处理（原子操作，避免竞态条件）
    // 使用 has() + add() 的组合，确保只有第一个调用者能通过检查
    if (processedMessages.has(message.id)) {
        logger.warn(`🔄 跳过重复消息: ${message.id} | 文本: ${message.text?.slice(0, 30)}`, { module: "listener", messageId: message.id });
        return;
    }
    // 标记为已处理（在异步操作前立即标记）
    processedMessages.add(message.id);
    inFlightMessages.add(message.id);
    logger.debug(`✅ 新消息标记: ${message.id} | 文本: ${message.text?.slice(0, 30)}`, { module: "listener", messageId: message.id });
    cleanCache();

    // 获取 chatId
    const chatId = message.chatId;
    if (!chatId) {
        if (debug) logger.debug("🔍 跳过无 chatId 消息", { module: "listener" });
        return;
    }

    // 简单速率限制（每 chatId 每秒最多 3 条，超限直接回复流控提示）
    const nowTs = Date.now();
    const bucket = rateLimitMap.get(chatId) || { tokens: RATE_LIMIT_TOKENS, last: nowTs };
    // 补充令牌
    const elapsed = nowTs - bucket.last;
    const refill = Math.floor(elapsed / RATE_LIMIT_WINDOW) * RATE_LIMIT_TOKENS;
    bucket.tokens = Math.min(RATE_LIMIT_TOKENS, bucket.tokens + refill);
    bucket.last = nowTs;

    if (bucket.tokens <= 0) {
        // 速率超限，直接提示并丢弃
        await sendReply(sdk, chatId, "⏳ 流控中，请稍后再发");
        logger.warn(`⚠️ 速率限制触发: ${chatId}`, { module: "listener", chatId });
        return;
    }
    bucket.tokens -= 1;
    rateLimitMap.set(chatId, bucket);

    // 基于内容的去重（防止相同内容的不同消息 id）
    if (message.text?.trim()) {
        // 限制 key 长度，避免内存问题
        const textPreview = message.text.trim().slice(0, 200);
        const contentKey = `${chatId}:${textPreview}`;
        const now = Date.now();
        const lastTime = recentMessageContents.get(contentKey);

        if (lastTime) {
            const elapsed = now - lastTime;
            // 1秒内的重复：视为系统重复检测（SDK Watcher + polling），直接跳过
            if (elapsed < CONTENT_DEDUP_IMMEDIATE_WINDOW) {
                logger.warn(`🔄 跳过系统重复: ${textPreview.slice(0, 30)}... (${elapsed}ms内)`, { module: "listener", chatId, elapsed });
                return;
            }
            // 1秒-10秒内的重复：可能是用户重复提问，记录但不阻止
            if (elapsed < CONTENT_DEDUP_WINDOW) {
                logger.info(`⚠️  检测到用户重复提问: ${textPreview.slice(0, 30)}... (${elapsed}ms前已处理过)`, { module: "listener", chatId, elapsed });
                // 不 return，允许处理
            }
        }

        recentMessageContents.set(contentKey, now);

        // 只在 Map 大小超过阈值时清理（避免每次都遍历）
        if (recentMessageContents.size > 50) {
            for (const [key, time] of recentMessageContents.entries()) {
                if (now - time > CONTENT_DEDUP_WINDOW * 2) {
                    recentMessageContents.delete(key);
                }
            }
        }
    }

    // 跳过空消息
    if (!message.text?.trim()) {
        if (debug) logger.debug("🔍 跳过空消息", { module: "listener" });
        // 空消息也要标记为已读，防止重复处理
        if (chatId) {
            await markAsReadSQLite(chatId);
        }
        return;
    }

    // 检查是否是配置的群组
    if (!isConfiguredChatId(chatId)) {
        const now = Date.now();
        const hit = unknownChatHits.get(chatId);
        if (!hit) {
            unknownChatHits.set(chatId, { count: 1, first: now });
        } else {
            hit.count += 1;
        }

        const lastWarn = unknownChatWarnCooldown.get(chatId) || 0;
        if (now - lastWarn > UNKNOWN_WARN_COOLDOWN) {
            logger.warn(`⚠️ 未配置的群组: ${chatId}`, { module: "listener", chatId });
            unknownChatWarnCooldown.set(chatId, now);
        }
        return;
    }

    // 白名单检查
    const securityCheck = checkWhitelist(message);
    if (!securityCheck.allowed) {
        logger.warn(`⚠️  ${securityCheck.reason}`, { module: "listener" });
        return;
    }

    // 路由到对应的 Bot
    const route = routeByChatId(chatId);
    if (!route) {
        logger.warn(`⚠️  无法路由: ${chatId}`, { module: "listener", chatId });
        // 未路由也需要标记为已读，避免重复触发
        await markAsReadSQLite(chatId);
        return;
    }

    // 提取路由信息（处理可能的 null 值，构建非 null 的 Route 对象）
    const routeChatId = route.chatId ?? chatId;
    const botType: BotType = route.botType ?? "default";
    const groupName = route.groupName ?? "";
    const projectDir = route.projectDir;

    // 获取处理器
    const handler = getHandler(botType);
    const context = {
        botType,
        chatId,
        groupName,
        projectDir,
        originalMessage: message,
    };

    // 打印日志
    console.log(`\n📨 [${groupName}] ${formatSender(message)}: ${message.text}`);
    logger.info(`📨 [${groupName}] ${formatSender(message)}: ${message.text}`, { module: "listener", groupName, sender: formatSender(message), text: message.text });

    // === 使用队列处理，确保每个 chatId 同时只处理一条消息 ===
    let handledSuccessfully = false;
    let lastError: unknown = null;
    let attempts = retryAttempts.get(messageId) ?? 0;

    while (attempts <= MAX_RETRIES) {
        try {
            await enqueueMessage(chatId, async () => {
                // 判断是否使用流式处理（message.text 已在前面检查过非空）
                const messageText = message.text ?? "";
                logger.info(`🔍 开始处理消息: ${messageText.slice(0, 30)}...`, { module: "listener", chatId, textLength: messageText.length });

                if (shouldStream({ chatId: routeChatId, groupName, projectDir, botType }, messageText)) {
                    logger.info(`🎬 使用流式处理`, { module: "listener", chatId, groupName });
                    // === 流式处理：使用 handleTmuxStream ===
                    try {
                        await handleTmuxStream(groupName, messageText, {
                            projectDir: projectDir ?? undefined,
                            onChunk: async (chunk, isToolUse) => {
                                const logPrefix = isToolUse ? "📤 [工具]" : "📤";
                                console.log(`${logPrefix} [${groupName}] Bot: ${chunk}`);
                                logger.info(`${logPrefix} [${groupName}] Bot: ${chunk}`, { module: "listener", groupName, isToolUse });
                                await sendReply(sdk, chatId, chunk);
                            }
                        });
                        logger.info(`✅ 流式处理完成`, { module: "listener", chatId, groupName });
                    } catch (error: any) {
                        logger.error(`❌ 流式处理错误: ${error.message}`, { module: "listener", groupName, error });
                        await sendReply(sdk, chatId, `处理失败: ${error.message}`);
                    }
                } else {
                    // === 命令处理：使用原有 handler.handle() ===
                    let result: HandleResult;
                    try {
                        result = await handler.handle(messageText, context);
                    } catch (error: any) {
                        logger.error(`❌ 处理错误: ${error.message}`, { module: "listener", groupName, error });
                        result = {
                            success: false,
                            error: error.message,
                        };
                    }

                    // 发送回复
                    if (result.response) {
                        console.log(`📤 [${groupName}] Bot: ${result.response}`);
                        logger.info(`📤 [${groupName}] Bot: ${result.response}`, { module: "listener", groupName });
                        await sendReply(sdk, chatId, result.response);
                    } else if (result.error) {
                        logger.error(`❌ 错误: ${result.error}`, { module: "listener", groupName });
                    }
                }

                // 标记消息为已读（使用 SQLite 方法）
                await markAsReadSQLite(chatId);
            });
            handledSuccessfully = true;
            break;
        } catch (error: any) {
            lastError = error;
            if (attempts < MAX_RETRIES) {
                processedMessages.delete(messageId);
                retryAttempts.set(messageId, attempts + 1);
                logger.warn(`⚠️  处理失败，将在 ${RETRY_DELAY}ms 后重试 (${attempts + 1}/${MAX_RETRIES})`, {
                    module: "listener",
                    messageId,
                    error: error?.message ?? String(error),
                });
                await sleep(RETRY_DELAY);
                attempts += 1;
                continue;
            }
            logger.error(`❌ 处理失败，已达最大重试次数`, { module: "listener", messageId, error });
            break;
        }
    }

    if (handledSuccessfully) {
        retryAttempts.delete(messageId);
        handledMessages.set(messageId, Date.now());
    } else if (attempts >= MAX_RETRIES) {
        retryAttempts.delete(messageId);
        handledMessages.set(messageId, Date.now()); // 避免重复处理同一失败消息
        if (lastError) {
            logger.error(`❌ 最终失败: ${String(lastError)}`, { module: "listener", messageId });
        }
    }

    // 清理并发标记
    inFlightMessages.delete(messageId);
}

/**
 * 启动消息监听
 *
 * @param sdk - IMessageSDK 实例
 * @param debug - 是否启用调试日志
 * @param useFileWatcher - 是否使用文件监听模式 (Phase 2 功能)
 */
export async function startListener(sdk: IMessageSDK, debug = false, useFileWatcher = false): Promise<DatabaseWatcher | null> {
    console.log("🎯 启动消息监听...\n");
    logger.info("启动消息监听", { module: "listener", debug, useFileWatcher });

    // 启动时打开 Messages 一次，标记所有消息为已读
    await markMessagesAsReadOnStartup();
    await verifyConfiguredChats();

    const handleMessageWrapper = async (message: Message) => {
        updateHeartbeat(); // 每次处理消息时更新心跳
        await handleMessage(message, { sdk, debug });
    };

    // 启动时检查一次未读消息
    await checkExistingMessages(sdk, debug, handleMessageWrapper);

    if (useFileWatcher && isFileWatchingAvailable()) {
        // 使用文件监听模式 (Phase 2)
        console.log("📡 使用文件监听模式 (低延迟)\n");
        logger.info("使用文件监听模式 (低延迟)", { module: "listener" });

        const watcher = createWatcher({
            sdk,
            onNewMessage: handleMessageWrapper,
            onGroupMessage: handleMessageWrapper,
            debug,
        });

        await watcher.start().catch((error) => {
            logger.error(`文件监听启动失败，回退到轮询模式: ${error.message}`, { module: "listener", error });
            console.error(`文件监听启动失败，回退到轮询模式: ${error.message}`);
            // 回退到 SDK 轮询
            sdk.startWatching({
                onNewMessage: handleMessageWrapper,
                onGroupMessage: handleMessageWrapper,
            });
            // 启动定期检查
            startPolling(sdk, debug, handleMessageWrapper);
        });

        console.log("✅ 监听器已启动，等待消息...\n");
        logger.info("监听器已启动，等待消息", { module: "listener", mode: "file" });
        await sendStartupAnnouncement(sdk);
        startHealthMonitor(sdk);
        return watcher;
    } else {
        // 使用 SDK Watcher + 轮询模式
        console.log("🔄 使用 SDK Watcher 模式\n");
        logger.info("使用 SDK Watcher 模式", { module: "listener" });

        sdk.startWatching({
            onNewMessage: handleMessageWrapper,
            onGroupMessage: handleMessageWrapper,
        });

        // 启动轮询作为补充（SDK Watcher 可能遗漏消息）
        startPolling(sdk, debug, handleMessageWrapper);

        // 启动心跳监控（防止 SDK Watcher 静默停摆）
        startHeartbeatMonitor(sdk, debug, handleMessageWrapper);

        console.log("✅ 监听器已启动，等待消息...\n");
        logger.info("监听器已启动，等待消息", { module: "listener", mode: "sdk" });
        await sendStartupAnnouncement(sdk);
        startHealthMonitor(sdk);
        return null;
    }
}

/**
 * 定期检查未读消息（补充 SDK watcher）
 */
function startPolling(
    sdk: IMessageSDK,
    debug: boolean,
    handler: (message: Message) => Promise<void>
): void {
    const CHECK_INTERVAL = 2000; // 2秒检查一次（优化：提高遗漏消息捕获率）

    setInterval(async () => {
        try {
            await checkExistingMessages(sdk, debug, handler);
        } catch (error: any) {
            logger.error(`❌ 轮询检查失败: ${error.message}`, { module: "listener", error });
            // 继续运行，不中断 interval
        }
    }, CHECK_INTERVAL);
}

/**
 * 检查启动时已存在的未读消息
 */
async function checkExistingMessages(
    sdk: IMessageSDK,
    debug: boolean,
    handler: (message: Message) => Promise<void>
): Promise<void> {
    try {
        const result = await sdk.getMessages({ unreadOnly: true });
        const unreadMessages = result.messages.filter(m => m.text?.trim());

        // 过滤掉已处理的消息（防止重复处理）
        const newMessages = unreadMessages.filter(m => m.id && !processedMessages.has(m.id));

        if (newMessages.length > 0) {
            console.log(`📬 [轮询] 检测到 ${newMessages.length} 条遗漏消息，开始处理...`);
            logger.info(`📬 [轮询] 检测到 ${newMessages.length} 条遗漏消息，开始处理`, { module: "listener", count: newMessages.length, source: "polling" });
            updateHeartbeat(); // 轮询检测到消息时更新心跳
            for (const msg of newMessages) {
                await handler(msg);

                // 标记为已读（使用 SQLite，带退避重试）
                if (msg.chatId && msg.id) {
                    let markSuccess = false;
                    let retryCount = 0;
                    const MAX_RETRIES = 2; // 最多重试 2 次
                    const RETRY_DELAY = 1000; // 1 秒退避

                    while (retryCount <= MAX_RETRIES && !markSuccess) {
                        try {
                            await markAsReadSQLite(msg.chatId);
                            markSuccess = true;
                        } catch (error: any) {
                            retryCount++;
                            if (retryCount <= MAX_RETRIES) {
                                logger.warn(`⚠️  markAsRead 失败 (第 ${retryCount} 次)，${RETRY_DELAY}ms 后重试`, {
                                    module: "listener",
                                    chatId: msg.chatId,
                                    retryCount,
                                    error: error.message
                                });
                                await sleep(RETRY_DELAY);
                            }
                        }
                    }

                    // 最终失败时，强制塞入 handled 缓存避免重复拉取
                    if (!markSuccess) {
                        logger.error(`❌ markAsRead 完全失败 (重试 ${MAX_RETRIES} 次后)，强制标记为已处理`, {
                            module: "listener",
                            messageId: msg.id,
                            chatId: msg.chatId
                        });
                        handledMessages.set(msg.id, Date.now());
                        processedMessages.add(msg.id); // 同时加入 processed 缓存
                    }
                }
            }
        } else if (debug && unreadMessages.length > 0) {
            console.log(`📭 [轮询] 已有 ${unreadMessages.length} 条未读消息已处理`);
            logger.debug(`📭 [轮询] 已有 ${unreadMessages.length} 条未读消息已处理`, { module: "listener", count: unreadMessages.length, source: "polling" });
        }
    } catch (error: any) {
        if (debug) {
            console.error("检查未读消息失败:", error.message);
            logger.error("检查未读消息失败", { module: "listener", error });
        }
    }
}
