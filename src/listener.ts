/**
 * msgcode: 消息监听器
 *
 * 监听 iMessage 消息，路由到对应处理器，并发送回复
 */

import type { IMessageSDK } from "@photon-ai/imessage-kit";
import type { Message } from "@photon-ai/imessage-kit";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

import { checkWhitelist, formatSender } from "./security.js";
import { routeByChatId, isConfiguredChatId, type Route, type BotType } from "./router.js";
import { getHandler, type HandleResult } from "./handlers.js";
import { createWatcher, isFileWatchingAvailable, type DatabaseWatcher } from "./watcher.js";
import { handleTmuxStream } from "./tmux/streamer.js";
import { logger } from "./logger/index.js";

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

/**
 * 最近处理的消息内容（基于文本的去重，防止相同内容的不同消息 id）
 * Key: "chatId:text", Value: timestamp
 */
const recentMessageContents = new Map<string, number>();
const CONTENT_DEDUP_WINDOW = 10000; // 10秒内相同文本视为重复

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
        try {
            await withTimeout(handler(), QUEUE_TIMEOUT, `消息处理超时 (${QUEUE_TIMEOUT}ms)`);
        } catch (error: any) {
            // 记录错误但继续处理后续消息
            logger.error(`❌ [${chatId}] 处理失败: ${error.message}`, { module: "listener", chatId, error });
            if (error.message.includes('超时')) {
                logger.error(`   可能原因: Claude 响应过慢或 tmux 会话卡死`, { module: "listener", chatId });
            }
        } finally {
            const elapsed = Date.now() - startTime;
            if (elapsed > 10000) {  // 超过 10 秒记录
                logger.info(`⏱️  [${chatId}] 处理耗时: ${elapsed}ms`, { module: "listener", chatId, elapsed });
            }
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
 */
const sentReplies = new Map<string, string>(); // chatId -> last reply
const REPLY_COOLDOWN = 10000; // 10秒内不重复发送相同回复

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

    // SQLite UPDATE 命令（单行格式，避免引号问题）
    const sql = `UPDATE message SET is_read=1, date_read=(strftime('%s','now')+978307200)*1000000000 WHERE ROWID IN (SELECT cmj.message_id FROM chat_message_join cmj JOIN chat c ON cmj.chat_id=c.ROWID WHERE c.guid='${escapedChatId}') AND is_read=0`;

    try {
        await execAsync(`sqlite3 "${MESSAGES_DB_PATH}" "${sql}"`, { timeout: 5000 });
    } catch (error: any) {
        // SQLite 失败时降级到 AppleScript
        const success = await markAsReadAppleScript(chatId);
        if (!success) {
            logger.warn(`⚠️ markAsRead 完全失败: ${error.message.slice(0, 40)}...`, { module: "listener", error });
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
        text.includes("deliverables and capabilities")) {
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

        // 检查是否在冷却期内（防止重复发送相同回复）
        const lastReply = sentReplies.get(chatId);
        if (lastReply === text) {
            return;
        }
        sentReplies.set(chatId, text);

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

    // 防止重复处理（原子操作，避免竞态条件）
    // 使用 has() + add() 的组合，确保只有第一个调用者能通过检查
    if (processedMessages.has(message.id)) {
        logger.warn(`🔄 跳过重复消息: ${message.id} | 文本: ${message.text?.slice(0, 30)}`, { module: "listener", messageId: message.id });
        return;
    }
    // 标记为已处理（在异步操作前立即标记）
    processedMessages.add(message.id);
    logger.debug(`✅ 新消息标记: ${message.id} | 文本: ${message.text?.slice(0, 30)}`, { module: "listener", messageId: message.id });
    cleanCache();

    // 获取 chatId
    const chatId = message.chatId;
    if (!chatId) {
        if (debug) logger.debug("🔍 跳过无 chatId 消息", { module: "listener" });
        return;
    }

    // 基于内容的去重（防止相同内容的不同消息 id）
    if (message.text?.trim()) {
        // 限制 key 长度，避免内存问题
        const textPreview = message.text.trim().slice(0, 200);
        const contentKey = `${chatId}:${textPreview}`;
        const now = Date.now();
        const lastTime = recentMessageContents.get(contentKey);

        if (lastTime && now - lastTime < CONTENT_DEDUP_WINDOW) {
            const elapsed = now - lastTime;
            logger.warn(`🔄 跳过重复内容: ${textPreview.slice(0, 30)}... (${elapsed}ms内)`, { module: "listener", chatId, elapsed });
            return;
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
        if (debug) logger.debug(`🔍 未配置的群组: ${chatId}`, { module: "listener", chatId });
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

    const handleMessageWrapper = async (message: Message) => {
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

        console.log("✅ 监听器已启动，等待消息...\n");
        logger.info("监听器已启动，等待消息", { module: "listener", mode: "sdk" });
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
    const CHECK_INTERVAL = 5000; // 5秒检查一次

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
            console.log(`📬 检测到 ${newMessages.length} 条新消息，开始处理...`);
            logger.info(`📬 检测到 ${newMessages.length} 条新消息，开始处理`, { module: "listener", count: newMessages.length });
            for (const msg of newMessages) {
                await handler(msg);
                // 标记为已读（使用 SQLite）
                if (msg.chatId) {
                    await markAsReadSQLite(msg.chatId);
                }
            }
        } else if (debug && unreadMessages.length > 0) {
            console.log(`📭 已有 ${unreadMessages.length} 条未读消息已处理`);
            logger.debug(`📭 已有 ${unreadMessages.length} 条未读消息已处理`, { module: "listener", count: unreadMessages.length });
        }
    } catch (error: any) {
        if (debug) {
            console.error("检查未读消息失败:", error.message);
            logger.error("检查未读消息失败", { module: "listener", error });
        }
    }
}
