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
import { handleTmuxStream, type StreamResult } from "./tmux/streamer.js";
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
const rateLimitNoticeAt = new Map<string, number>(); // chatId -> last notice timestamp
const RATE_LIMIT_NOTICE_COOLDOWN = 10000; // 10秒内只提示一次流控
let healthTimer: ReturnType<typeof setInterval> | null = null;
const HEALTH_INTERVAL = 300000; // 5 分钟健康检查，降低日志噪音
const markReadFailures = new Map<string, number>(); // chatId -> 连续失败次数
/* 启动时只处理最近 N 条未读，避免历史积压被一次性推送 */
const MAX_STARTUP_UNREAD = 2;

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
let lastPollHit = Date.now(); // 轮询命中时间戳
let lastChunkActivity = Date.now(); // 最近一次流式 chunk 活动时间
let watcherStallCount = 0;
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
const MAX_CONTENT_CACHE_SIZE = 200; // P1 修复：内容去重缓存最大条目数

/**
 * 消息处理队列（每个 chatId 一个队列，确保顺序处理）
 */
const processingQueues = new Map<string, {
    promise: Promise<void>;
    startTime: number;
    version: number;  // 版本号，用于检测重置
    pending: number;  // 待处理数量（含当前）
    lastBusyLogAt: number;
}>();

/**
 * 队列处理超时时间（毫秒）
 */
const QUEUE_TIMEOUT = 360000; // 6 分钟（比 streamer 的 5 分钟多 1 分钟缓冲）
const MAX_QUEUE_DEPTH = 20; // 队列最大深度（超过则丢弃并记录）
const QUEUE_BUSY_LOG_COOLDOWN = 5000; // 排队日志冷却，避免刷屏

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

function updatePollHit(): void {
    lastPollHit = Date.now();
}

function resetWatcherStallCount(): void {
    watcherStallCount = 0;
}

function markStreamActivity(): void {
    lastChunkActivity = Date.now();
    updateHeartbeat();
    updatePollHit();
    resetWatcherStallCount();
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
        const pollSilent = now - lastPollHit;
        const streamSilent = now - lastChunkActivity;

        // 检查是否有正在处理的队列（避免误报）
        const hasInFlight = processingQueues.size > 0 || inFlightMessages.size > 0;

        // 检查是否超时（只有在没有正在处理的消息时才报停摆）
        if (inactiveTime > HEARTBEAT_ACTIVITY_TIMEOUT && pollSilent > HEARTBEAT_ACTIVITY_TIMEOUT && streamSilent > HEARTBEAT_ACTIVITY_TIMEOUT && !hasInFlight) {
            watcherStallCount += 1;
            logger.warn(`⚠️  检测到 SDK Watcher 停摆 (${Math.floor(inactiveTime / 1000)}s 无活动，连续 ${watcherStallCount} 次)，开始自愈`, {
                module: "listener",
                inactiveTime,
                lastActivity: new Date(lastActivity).toISOString(),
                watcherStallCount
            });

            if (watcherStallCount >= 2) {
                logger.error("❌ SDK Watcher 连续停摆，触发重启", { module: "listener", watcherStallCount });
                process.exit(1);
            }

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
async function enqueueMessage(chatId: string, handler: () => Promise<void>): Promise<boolean> {
    let existing = processingQueues.get(chatId);
    const now = Date.now();

    if (existing && existing.pending >= MAX_QUEUE_DEPTH) {
        logger.error(`队列过载，丢弃消息`, {
            module: "listener",
            chatId,
            pending: existing.pending,
            max: MAX_QUEUE_DEPTH,
        });
        return false;
    }

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
    const pending = (existing?.pending ?? 0) + 1;
    const lastBusyLogAt = existing?.lastBusyLogAt ?? 0;
    const startTime = existing?.startTime ?? now;

    const wrappedHandler = async () => {
        const currentEntry = processingQueues.get(chatId);
        if (currentEntry) {
            currentEntry.startTime = Date.now();
            processingQueues.set(chatId, currentEntry);
        }
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
            const current = processingQueues.get(chatId);
            if (current) {
                current.pending = Math.max(0, current.pending - 1);
                processingQueues.set(chatId, current);
            }
        }
        if (handlerError) {
            throw handlerError;
        }
    };

    const nextPromise = existing
        ? existing.promise.then(wrappedHandler, wrappedHandler)
        : wrappedHandler();

    if (pending > 1 && now - lastBusyLogAt > QUEUE_BUSY_LOG_COOLDOWN) {
        logger.info(`队列排队`, { module: "listener", chatId, pending, max: MAX_QUEUE_DEPTH });
    }

    processingQueues.set(chatId, {
        promise: nextPromise,
        startTime,
        version: nextVersion,
        pending,
        lastBusyLogAt: pending > 1 ? now : lastBusyLogAt,
    });

    try {
        await nextPromise;
    } finally {
        // 只有当前版本匹配时才清理（防止旧 Promise 清理新队列）
        const current = processingQueues.get(chatId);
        if (current && current.version === nextVersion && current.pending <= 0) {
            processingQueues.delete(chatId);
        }
    }
    return true;
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

    // P1 修复：限制 recentMessageContents 大小
    if (recentMessageContents.size > MAX_CONTENT_CACHE_SIZE) {
        // 按时间排序，删除最旧的一半
        const contentEntries = Array.from(recentMessageContents.entries())
            .sort((a, b) => a[1] - b[1]);
        const deleteCount = Math.floor(contentEntries.length / 2);
        for (let i = 0; i < deleteCount; i++) {
            recentMessageContents.delete(contentEntries[i][0]);
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
        healthCheck(sdk).catch(() => { });
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
 * 检测完全磁盘访问权限
 *
 * 尝试读取 chat.db 文件来判断是否有权限访问
 */
async function checkDiskAccessPermission(): Promise<boolean> {
    try {
        // 尝试以只读方式打开文件（快速检测）
        const handle = await fs.promises.open(MESSAGES_DB_PATH, "r");
        await handle.close();
        return true;
    } catch {
        // 权限不足或文件不存在
        return false;
    }
}

/**
 * 打印完全磁盘访问权限引导信息
 */
function printPermissionGuide(): void {
    console.error("\n" + "=".repeat(60));
    console.error("🚨 缺少完全磁盘访问权限");
    console.error("=".repeat(60));
    console.error("\n📋 解决方法：");
    console.error("   1. 打开 系统设置 → 隐私与安全性");
    console.error("   2. 选择 完全磁盘访问权限");
    console.error("   3. 找到并启用 终端 (Terminal)");
    console.error("   4. 如果使用 IDE (VS Code/Xcode 等)，也请启用");
    console.error("\n💡 提示：");
    console.error("   - 修改设置后可能需要重启终端");
    console.error("   - 如果使用 Tmux，确保 Terminal.app 已在授权列表中");
    console.error("\n" + "=".repeat(60) + "\n");
    logger.error("🚨 缺少完全磁盘访问权限，请手动授权", { module: "listener" });
}

/**
 * 检测 Messages 是否已登录账户
 *
 * 检查是否有 iMessage service 存在（不要求状态为 available）
 */
async function checkMessagesAccount(): Promise<{ loggedIn: boolean; account?: string }> {
    try {
        // AppleScript 获取所有 service，检查是否有 iMessage 类型
        const script = `
            tell application "Messages"
                if (count of services) > 0 then
                    repeat with aService in services
                        -- 检查是否是 iMessage 类型的 service
                        if service type of aService is iMessage then
                            return name of aService
                        end if
                    end repeat
                    -- 回退：返回第一个 service 的名称
                    return name of first service
                end if
                return "NO_ACCOUNT"
            end tell
        `.trim();

        const { stdout } = await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: 5000 });
        const result = stdout.trim();

        if (result === "NO_ACCOUNT" || !result) {
            return { loggedIn: false };
        }

        return { loggedIn: true, account: result };
    } catch {
        // AppleScript 失败时，尝试检查是否能获取 chat 列表作为备选
        try {
            const fallbackScript = `tell application "Messages" to count of chats`;
            const { stdout } = await execAsync(`osascript -e '${fallbackScript}'`, { timeout: 5000 });
            const chatCount = parseInt(stdout.trim());
            if (chatCount >= 0) {
                return { loggedIn: true, account: "iMessage" };
            }
        } catch {
            // 忽略
        }
        return { loggedIn: false };
    }
}

/**
 * 打印 Messages 登录引导信息
 */
function printMessagesLoginGuide(): void {
    console.error("\n" + "=".repeat(60));
    console.error("🚨 Messages 未登录");
    console.error("=".repeat(60));
    console.error("\n📋 解决方法：");
    console.error("   1. 打开 Messages (信息) 应用");
    console.error("   2. 登录你的 Apple ID (iMessage 账户)");
    console.error("   3. 确认登录成功后重启 msgcode");
    console.error("\n💡 提示：");
    console.error("   - 不需要登录 iCloud");
    console.error("   - Messages → 设置 → iMessage → 确保已启用");
    console.error("\n" + "=".repeat(60) + "\n");
    logger.error("🚨 Messages 未登录账户", { module: "listener" });
}

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
 *
 * P1 修复：增加控制字符转义，提高鲁棒性
 */
function escapeAppleScriptString(str: string): string {
    return str
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\n")
        .replace(/\r/g, "\\r")
        .replace(/\t/g, "\\t");
}

/**
 * 获取群聊最近一条“我发送”的消息 ROWID（用于发送确认）
 */
async function getLatestOutgoingRowId(chatId: string): Promise<number | null> {
    const fullChatId = chatId.includes(";") ? chatId : `any;+;${chatId}`;
    const escapedChatId = escapeSqlString(fullChatId);
    const sql = `SELECT MAX(m.ROWID) FROM message m JOIN chat_message_join cmj ON m.ROWID=cmj.message_id JOIN chat c ON cmj.chat_id=c.ROWID WHERE c.guid='${escapedChatId}' AND m.is_from_me=1`;
    try {
        const { stdout } = await execAsync(`sqlite3 "${MESSAGES_DB_PATH}" "${sql}"`, { timeout: 5000 });
        const value = stdout.trim();
        if (!value) return null;
        const rowId = Number(value);
        return Number.isFinite(rowId) ? rowId : null;
    } catch (error: any) {
        logger.warn(`⚠️ 群聊发送确认读取失败: ${error.message}`, { module: "listener", chatId });
        return null;
    }
}

type GroupDeliveryStatus = {
    rowId: number;
    guid: string;
    isSent: number;
    isDelivered: number;
    dateDelivered: number | null;
    isRead: number;
    dateRead: number | null;
    error: number;
    isFinished: number;
};

const GROUP_DELIVERY_VERIFY_TIMEOUT = 6000;
const GROUP_DELIVERY_VERIFY_INTERVAL = 1000;
const GROUP_DELIVERY_RETRY_LIMIT = 1;
const GROUP_RETRY_COOLDOWN = 60000;
const groupRetryHistory = new Map<string, number>();

function isGroupDeliveryConfirmed(delivery: GroupDeliveryStatus | null): boolean {
    if (!delivery) return false;
    return delivery.isDelivered === 1 || delivery.isSent === 1;
}

async function waitForGroupDelivery(chatId: string, rowId: number): Promise<GroupDeliveryStatus | null> {
    const deadline = Date.now() + GROUP_DELIVERY_VERIFY_TIMEOUT;
    let lastStatus: GroupDeliveryStatus | null = null;
    while (Date.now() < deadline) {
        const status = await getGroupDeliveryStatus(chatId, rowId);
        if (status) {
            lastStatus = status;
            if (isGroupDeliveryConfirmed(status)) {
                return status;
            }
        }
        await sleep(GROUP_DELIVERY_VERIFY_INTERVAL);
    }
    return lastStatus ?? getGroupDeliveryStatus(chatId, rowId);
}

function shouldRetryGroupSend(chatId: string, text: string): boolean {
    const trimmed = text.trim();
    if (trimmed.length < 12) {
        return false;
    }
    if (/思考中|流控|等待交互|处理失败/.test(trimmed)) {
        return false;
    }
    const key = `${chatId}:${text.slice(0, 80)}`;
    const now = Date.now();
    const last = groupRetryHistory.get(key);
    if (last && now - last < GROUP_RETRY_COOLDOWN) {
        return false;
    }
    groupRetryHistory.set(key, now);
    return true;
}

async function confirmGroupSend(chatId: string, beforeRowId: number | null): Promise<number | null> {
    for (let i = 0; i < 3; i++) {
        await sleep(200);
        const afterRowId = await getLatestOutgoingRowId(chatId);
        if (afterRowId !== null && (beforeRowId === null || afterRowId > beforeRowId)) {
            return afterRowId;
        }
    }
    return null;
}

async function getGroupDeliveryStatus(chatId: string, rowId: number): Promise<GroupDeliveryStatus | null> {
    const fullChatId = chatId.includes(";") ? chatId : `any;+;${chatId}`;
    const escapedChatId = escapeSqlString(fullChatId);
    const sql = `SELECT m.ROWID, m.guid, m.is_sent, m.is_delivered, m.date_delivered, m.is_read, m.date_read, m.error, m.is_finished FROM message m JOIN chat_message_join cmj ON m.ROWID=cmj.message_id JOIN chat c ON cmj.chat_id=c.ROWID WHERE c.guid='${escapedChatId}' AND m.ROWID=${rowId} LIMIT 1`;
    try {
        const { stdout } = await execAsync(`sqlite3 -separator '|' "${MESSAGES_DB_PATH}" "${sql}"`, { timeout: 5000 });
        const line = stdout.trim();
        if (!line) return null;
        const parts = line.split("|");
        if (parts.length < 9) return null;
        const [
            rowIdText,
            guid,
            isSentText,
            isDeliveredText,
            dateDeliveredText,
            isReadText,
            dateReadText,
            errorText,
            isFinishedText,
        ] = parts;
        const rowIdValue = Number(rowIdText);
        if (!Number.isFinite(rowIdValue)) return null;
        const isSent = Number(isSentText);
        const isDelivered = Number(isDeliveredText);
        const dateDelivered = dateDeliveredText ? Number(dateDeliveredText) : null;
        const isRead = Number(isReadText);
        const dateRead = dateReadText ? Number(dateReadText) : null;
        const error = Number(errorText);
        const isFinished = Number(isFinishedText);
        return {
            rowId: rowIdValue,
            guid,
            isSent: Number.isFinite(isSent) ? isSent : 0,
            isDelivered: Number.isFinite(isDelivered) ? isDelivered : 0,
            dateDelivered: Number.isFinite(dateDelivered ?? NaN) ? dateDelivered : null,
            isRead: Number.isFinite(isRead) ? isRead : 0,
            dateRead: Number.isFinite(dateRead ?? NaN) ? dateRead : null,
            error: Number.isFinite(error) ? error : 0,
            isFinished: Number.isFinite(isFinished) ? isFinished : 0,
        };
    } catch (error: any) {
        logger.warn(`⚠️ 群聊回执读取失败: ${error.message}`, { module: "listener", chatId, rowId });
        return null;
    }
}

type GroupSendOptions = {
    allowRetry?: boolean;
};

async function sendToChatGroupOnce(chatId: string, text: string, attempt: number): Promise<{
    rowId: number | null;
    delivery: GroupDeliveryStatus | null;
}> {
    const start = Date.now();
    logger.info(`📤 [AS] 群组发送开始`, { module: "listener", chatId, length: text.length, attempt });
    const beforeRowId = await getLatestOutgoingRowId(chatId);
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
    const confirmedRowId = await confirmGroupSend(chatId, beforeRowId);
    if (confirmedRowId !== null) {
        logger.info(`📤 [AS] 群组发送已入库`, { module: "listener", chatId, elapsed: Date.now() - start, attempt });
    } else {
        logger.warn(`📤 [AS] 群组发送未入库`, { module: "listener", chatId, elapsed: Date.now() - start, attempt });
    }
    const rowIdForCheck = confirmedRowId ?? await getLatestOutgoingRowId(chatId);
    if (rowIdForCheck !== null) {
        const delivery = await getGroupDeliveryStatus(chatId, rowIdForCheck);
        if (delivery) {
            const deliveryText = `📤 [AS] 群组回执细节 rowId=${delivery.rowId} sent=${delivery.isSent} delivered=${delivery.isDelivered} date_delivered=${delivery.dateDelivered ?? "null"} read=${delivery.isRead} date_read=${delivery.dateRead ?? "null"} error=${delivery.error} finished=${delivery.isFinished}`;
            logger.info(deliveryText, { module: "listener", chatId, attempt });
            logger.info(`📤 [AS] 群组回执`, {
                module: "listener",
                chatId,
                rowId: delivery.rowId,
                guid: delivery.guid,
                isSent: delivery.isSent,
                isDelivered: delivery.isDelivered,
                dateDelivered: delivery.dateDelivered,
                isRead: delivery.isRead,
                dateRead: delivery.dateRead,
                error: delivery.error,
                isFinished: delivery.isFinished,
                attempt,
            });
            return { rowId: rowIdForCheck, delivery };
        }
        logger.warn(`📤 [AS] 群组回执缺失`, { module: "listener", chatId, rowId: rowIdForCheck, attempt });
        return { rowId: rowIdForCheck, delivery: null };
    }
    logger.warn(`📤 [AS] 群组回执缺失`, { module: "listener", chatId, rowId: null, attempt });
    return { rowId: null, delivery: null };
}

/**
 * 发送到群组（使用 AppleScript，SDK 不支持群组）
 */
async function sendToChatGroup(chatId: string, text: string, options?: GroupSendOptions): Promise<void> {
    const allowRetry = options?.allowRetry !== false && GROUP_DELIVERY_RETRY_LIMIT > 0;
    const { rowId, delivery } = await sendToChatGroupOnce(chatId, text, 0);
    if (!allowRetry || rowId === null) {
        return;
    }
    if (isGroupDeliveryConfirmed(delivery)) {
        return;
    }

    const verified = await waitForGroupDelivery(chatId, rowId);
    if (isGroupDeliveryConfirmed(verified)) {
        return;
    }

    logger.warn(`群组回执超时，准备重发`, {
        module: "listener",
        chatId,
        rowId,
        sent: verified?.isSent ?? 0,
        delivered: verified?.isDelivered ?? 0,
        error: verified?.error ?? 0,
    });

    if (!shouldRetryGroupSend(chatId, text)) {
        logger.warn(`群组重发跳过（冷却中）`, { module: "listener", chatId, rowId });
        return;
    }

    await sendToChatGroupOnce(chatId, text, 1);
}

/**
 * 发送给个人（使用 SDK）
 */
async function sendToIndividual(sdk: IMessageSDK, chatId: string, text: string): Promise<void> {
    // chatId 格式: any;-;email@example.com
    const parts = chatId.split(";-;");
    const address = parts[1] || chatId;
    /* SDK 发送详细日志：定位卡住/超时 */
    const start = Date.now();
    logger.info(`📤 [SDK] 发送开始`, { module: "listener", chatId, address, length: text.length });
    try {
        const result = await withTimeout(sdk.send(address, text), 8000, "sdk.send timeout");
        logger.info(`📤 [SDK] 发送完成`, { module: "listener", chatId, address, elapsed: Date.now() - start, result });
    } catch (error: any) {
        logger.error(`📤 [SDK] 发送失败: ${error.message}`, { module: "listener", chatId, address, elapsed: Date.now() - start, error });
        // SDK 失败时降级到 AppleScript
        const fallbackStart = Date.now();
        try {
            await sendToIndividualAppleScript(address, text);
            logger.warn(`📤 [SDK] 降级 AppleScript 成功`, { module: "listener", chatId, address, elapsed: Date.now() - fallbackStart });
        } catch (fallbackError: any) {
            logger.error(`📤 [SDK] 降级 AppleScript 失败: ${fallbackError.message}`, { module: "listener", chatId, address, elapsed: Date.now() - fallbackStart, error: fallbackError });
            throw error;
        }
    }
}

/**
 * 发送给个人（AppleScript 降级）
 */
async function sendToIndividualAppleScript(address: string, text: string): Promise<void> {
    const escapedAddress = escapeAppleScriptString(address);
    const escapedText = escapeAppleScriptString(text);
    const script = `
tell application "Messages"
    set targetService to first service whose service type = iMessage
    set targetBuddy to buddy "${escapedAddress}" of targetService
    send "${escapedText}" to targetBuddy
end tell
`.trim();

    await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: 5000 });
}


/**
 * 检查是否应该跳过该输出（过滤 plugin 等无关输出）
 */
function shouldSkipOutput(text: string): boolean {
    if (!text.trim()) {
        return true;
    }
    return false;
}

/**
 * 发送回复
 */
type ReplyOptions = {
    allowRetry?: boolean;
};

async function sendReply(sdk: IMessageSDK, chatId: string, text: string, options?: ReplyOptions): Promise<void> {
    try {
        // 过滤 plugin/MCP 等无关输出
        if (shouldSkipOutput(text)) {
            logger.info(`✅ 已跳过发送 (${text.length}字符)`, { module: "listener", chatId, preview: text.slice(0, 30) });
            return;
        }

        // 长文本截断（避免 iMessage 发送失败）
        const maxLength = 8000;
        if (text.length > maxLength) {
            text = text.slice(0, maxLength - 40) + "\n\n...（已截断）";
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
            await sendToChatGroup(chatId, text, { allowRetry: options?.allowRetry });
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

    // 防止重复处理（使size检查减少竞态窗口）
    // P1 修复：使用 size 检查减少竞态窗口，防御性编程
    const sizeBefore = processedMessages.size;
    processedMessages.add(message.id);
    if (processedMessages.size === sizeBefore) {
        logger.warn(`🔄 跳过重复消息: ${message.id} | 文本: ${message.text?.slice(0, 30)}`, { module: "listener", messageId: message.id });
        return;
    }
    // 标记为已处理（在异步操作前立即标记）
    inFlightMessages.add(message.id);
    logger.debug(`✅ 新消息标记: ${message.id} | 文本: ${message.text?.slice(0, 30)}`, { module: "listener", messageId: message.id });
    cleanCache();

    // 获取 chatId
    const chatId = message.chatId;
    if (!chatId) {
        if (debug) logger.debug("🔍 跳过无 chatId 消息", { module: "listener" });
        return;
    }

    const text = message.text?.trim();
    // 跳过空消息
    if (!text) {
        if (debug) logger.debug("🔍 跳过空消息", { module: "listener" });
        // 空消息也要标记为已读，防止重复处理
        if (chatId) {
            await markAsReadSQLite(chatId);
        }
        return;
    }

    // 基于内容的去重（防止相同内容的不同消息 id）
    // 限制 key 长度，避免内存问题
    const textPreview = text.slice(0, 200);
    const contentKey = `${chatId}:${textPreview}`;
    const now = Date.now();
    const lastTime = recentMessageContents.get(contentKey);

    if (lastTime) {
        const elapsed = now - lastTime;
        // 1秒内的重复：视为系统重复检测（SDK Watcher + polling），直接跳过
        if (elapsed < CONTENT_DEDUP_IMMEDIATE_WINDOW) {
            logger.warn(`🔄 跳过系统重复: ${textPreview.slice(0, 30)}... (${elapsed}ms内)`, { module: "listener", chatId, elapsed });
            await markAsReadSQLite(chatId);
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

    // 简单速率限制（每 chatId 每秒最多 3 条，超限直接回复流控提示）
    const nowTs = now;
    const bucket = rateLimitMap.get(chatId) || { tokens: RATE_LIMIT_TOKENS, last: nowTs };
    // 补充令牌
    const elapsed = nowTs - bucket.last;
    const refill = Math.floor(elapsed / RATE_LIMIT_WINDOW) * RATE_LIMIT_TOKENS;
    bucket.tokens = Math.min(RATE_LIMIT_TOKENS, bucket.tokens + refill);
    bucket.last = nowTs;

    if (bucket.tokens <= 0) {
        // 速率超限，节流提示
        const lastNotice = rateLimitNoticeAt.get(chatId) || 0;
        if (nowTs - lastNotice > RATE_LIMIT_NOTICE_COOLDOWN) {
            await sendReply(sdk, chatId, "⏳ 流控中，请稍后再发");
            rateLimitNoticeAt.set(chatId, nowTs);
        }
        logger.warn(`⚠️ 速率限制触发: ${chatId}`, { module: "listener", chatId });
        await markAsReadSQLite(chatId);
        return;
    }
    bucket.tokens -= 1;
    rateLimitMap.set(chatId, bucket);

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
            const queued = await enqueueMessage(chatId, async () => {
                // 判断是否使用流式处理（message.text 已在前面检查过非空）
                const messageText = message.text ?? "";
                logger.info(`🔍 开始处理消息: ${messageText.slice(0, 30)}...`, { module: "listener", chatId, textLength: messageText.length });

                if (shouldStream({ chatId: routeChatId, groupName, projectDir, botType }, messageText)) {
                    logger.info(`🎬 使用流式处理`, { module: "listener", chatId, groupName });
                    // === 流式处理：使用 handleTmuxStream ===
                    let streamResult: StreamResult | null = null;
                    try {
                        streamResult = await handleTmuxStream(groupName, messageText, {
                            projectDir: projectDir ?? undefined,
                            onChunk: async (chunk, isToolUse) => {
                                const logPrefix = isToolUse ? "📤 [工具]" : "📤";
                                console.log(`${logPrefix} [${groupName}] Bot: ${chunk}`);
                                logger.info(`${logPrefix} [${groupName}] Bot: ${chunk}`, { module: "listener", groupName, isToolUse });
                                await sendReply(sdk, chatId, chunk, { allowRetry: false });
                                markStreamActivity();
                            },
                            attachments: message.attachments,
                        });
                        logger.info(`✅ 流式处理完成`, { module: "listener", chatId, groupName, streamResult });
                    } catch (error: any) {
                        logger.error(`❌ 流式处理错误: ${error.message}`, { module: "listener", groupName, error });
                        await sendReply(sdk, chatId, `处理失败: ${error.message}`);
                        throw error;
                    }

                    if (streamResult && streamResult.success === false && streamResult.error) {
                        logger.warn(`⚠️ 流式处理失败: ${streamResult.error}`, { module: "listener", groupName, streamResult });
                        await sendReply(sdk, chatId, `⚠️ ${streamResult.error}`);
                        return;
                    }

                    if (streamResult && !streamResult.finished) {
                        const reason = streamResult.finishReason ?? (streamResult.timedOut ? "超时" : "未知原因");
                        logger.warn(`⚠️ 流式处理未检测到完成标记 (${reason})`, { module: "listener", groupName, streamResult });
                        if (streamResult.timedOut) {
                            await sendReply(sdk, chatId, "⚠️ Claude 似乎没完成回复，正在重试...");
                        }
                    }

                    const prompt = streamResult?.interactionPrompt;
                    if (prompt) {
                        logger.warn(`⚠️ Claude 需要交互: ${prompt}`, { module: "listener", groupName });
                        await sendReply(sdk, chatId, `🚧 Claude 当前在等待交互（${prompt}），请打开 tmux 终端输入相应选项`);
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
            if (!queued) {
                logger.warn(`消息未入队（队列过载）`, { module: "listener", chatId, messageId });
                await markAsReadSQLite(chatId);
                handledSuccessfully = true;
                break;
            }
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

    // 启动时检测磁盘访问权限
    const hasPermission = await checkDiskAccessPermission();
    if (!hasPermission) {
        printPermissionGuide();
        // 提示用户并退出
        console.error("❌ 权限不足，无法继续运行。请完成授权后重启。\n");
        process.exit(1);
        return null;
    }
    logger.info("✅ 完全磁盘访问权限检查通过", { module: "listener" });

    // 启动时检测 Messages 账户登录状态
    const accountStatus = await checkMessagesAccount();
    if (!accountStatus.loggedIn) {
        printMessagesLoginGuide();
        console.error("❌ Messages 未登录，无法接收和发送消息。请登录后重启。\n");
        process.exit(1);
        return null;
    }
    logger.info(`✅ Messages 账户检查通过: ${accountStatus.account}`, { module: "listener" });

    // 启动时打开 Messages 一次，标记所有消息为已读
    await markMessagesAsReadOnStartup();
    await verifyConfiguredChats();

    const handleMessageWrapper = async (message: Message) => {
        updateHeartbeat(); // 每次处理消息时更新心跳
        resetWatcherStallCount();
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
            if (!config.skipUnreadBacklog) {
                startPolling(sdk, debug, handleMessageWrapper);
            } else {
                logger.warn("⚠️ 已禁用未读轮询（按配置不补发积压消息）", { module: "listener" });
            }
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
        if (!config.skipUnreadBacklog) {
            startPolling(sdk, debug, handleMessageWrapper);
        } else {
            logger.warn("⚠️ 已禁用未读轮询（按配置不补发积压消息）", { module: "listener" });
        }

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

        if (config.skipUnreadBacklog) {
            if (unreadMessages.length === 0) {
                return;
            }
            const discardChatIds = new Set<string>();
            for (const msg of unreadMessages) {
                if (msg.id) {
                    handledMessages.set(msg.id, Date.now());
                    processedMessages.add(msg.id);
                }
                if (msg.chatId) {
                    discardChatIds.add(msg.chatId);
                }
            }

            for (const chatId of discardChatIds) {
                await markAsReadSQLite(chatId);
            }

            logger.warn(`⚠️ 已忽略未读积压消息 ${unreadMessages.length} 条（按配置不补发）`, {
                module: "listener",
                count: unreadMessages.length,
            });
            return;
        }

        // 过滤掉已处理的消息（防止重复处理）
        const newMessages = unreadMessages.filter(m => m.id && !processedMessages.has(m.id));
        let messagesToProcess = newMessages;
        let discardedCount = 0;

        if (newMessages.length > MAX_STARTUP_UNREAD) {
            const sorted = [...newMessages].sort((a, b) => (Number(b.date) || 0) - (Number(a.date) || 0));
            const keep = sorted.slice(0, MAX_STARTUP_UNREAD);
            const discard = sorted.slice(MAX_STARTUP_UNREAD);
            discardedCount = discard.length;

            const discardChatIds = new Set<string>();
            for (const msg of discard) {
                if (msg.id) {
                    handledMessages.set(msg.id, Date.now());
                    processedMessages.add(msg.id);
                }
                if (msg.chatId) {
                    discardChatIds.add(msg.chatId);
                }
            }

            for (const chatId of discardChatIds) {
                await markAsReadSQLite(chatId);
            }

            logger.warn(`⚠️ 启动未读过多，已丢弃 ${discardedCount} 条，仅处理最近 ${MAX_STARTUP_UNREAD} 条`, {
                module: "listener",
                discardedCount,
                limit: MAX_STARTUP_UNREAD,
            });

            // 保持处理顺序为时间正序
            messagesToProcess = keep.sort((a, b) => (Number(a.date) || 0) - (Number(b.date) || 0));
        }

        if (messagesToProcess.length > 0) {
            updatePollHit();
            console.log(`📬 [轮询] 检测到 ${messagesToProcess.length} 条遗漏消息，开始处理...`);
            logger.info(`📬 [轮询] 检测到 ${messagesToProcess.length} 条遗漏消息，开始处理`, { module: "listener", count: messagesToProcess.length, source: "polling", discardedCount });
            updateHeartbeat(); // 轮询检测到消息时更新心跳
            resetWatcherStallCount();
            for (const msg of messagesToProcess) {
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
