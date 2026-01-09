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
import { routeByChatId, isConfiguredChatId, type Route } from "./router.js";
import { getHandler, type HandleResult } from "./handlers.js";
import { createWatcher, isFileWatchingAvailable, type DatabaseWatcher } from "./watcher.js";
import { handleTmuxStream } from "./tmux/streamer.js";

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
        await execAsync(`open -a Messages`);
    } catch {
        // 忽略错误
    }
}

/**
 * 转义 AppleScript 字符串
 */
function escapeAppleScriptString(str: string): string {
    return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * 发送到群组（使用 AppleScript）
 */
async function sendToChatGroup(chatId: string, text: string): Promise<void> {
    // 确保使用完整格式 any;+;GUID
    const fullChatId = chatId.includes(";") ? chatId : `any;+;${chatId}`;

    const escapedText = escapeAppleScriptString(text);
    const escapedChatId = escapeAppleScriptString(fullChatId);

    const script = `
tell application "Messages"
    set targetChat to chat id "${escapedChatId}"
    send "${escapedText}" to targetChat
end tell
`.trim();

    await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
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
 * 发送回复
 */
async function sendReply(sdk: IMessageSDK, chatId: string, text: string): Promise<void> {
    try {
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
            // 群组使用 AppleScript 发送
            await sendToChatGroup(chatId, text);
        } else {
            // 个人使用 SDK 发送
            await sendToIndividual(sdk, chatId, text);
        }
    } catch (error: any) {
        console.error(`❌ 发送失败: ${error.message}`);
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
        if (debug) console.log("🔍 跳过无 id 消息");
        return;
    }

    // 防止重复处理
    if (processedMessages.has(message.id)) {
        if (debug) console.log(`🔄 已处理过: ${message.id}`);
        return;
    }
    processedMessages.add(message.id);
    cleanCache();

    // 跳过空消息
    if (!message.text?.trim()) {
        if (debug) console.log("🔍 跳过空消息");
        // 空消息也要标记为已读，防止重复处理
        try {
            const fullChatId = message.chatId;
            if (fullChatId) {
                await execAsync(`osascript -e 'tell application "Messages" to set read of chat id "${fullChatId}" to true' 2>/dev/null`);
            }
        } catch {
            // 忽略标记失败
        }
        return;
    }

    // 获取 chatId
    const chatId = message.chatId;
    if (!chatId) {
        if (debug) console.log("🔍 跳过无 chatId 消息");
        return;
    }

    // 检查是否是配置的群组
    if (!isConfiguredChatId(chatId)) {
        if (debug) console.log(`🔍 未配置的群组: ${chatId}`);
        return;
    }

    // 白名单检查
    const securityCheck = checkWhitelist(message);
    if (!securityCheck.allowed) {
        console.warn(`⚠️  ${securityCheck.reason}`);
        return;
    }

    // 路由到对应的 Bot
    const route = routeByChatId(chatId);
    if (!route) {
        console.warn(`⚠️  无法路由: ${chatId}`);
        return;
    }

    // 获取处理器
    const handler = getHandler(route.botType || "default");
    const context = {
        botType: route.botType || "default",
        chatId,
        groupName: route.groupName,
        projectDir: route.projectDir,
        originalMessage: message,
    };

    // 打印日志
    console.log(`\n📨 [${route.groupName}] ${formatSender(message)}: ${message.text}`);

    // 判断是否使用流式处理
    if (shouldStream(route, message.text)) {
        // === 流式处理：使用 handleTmuxStream ===
        try {
            await handleTmuxStream(route.groupName, message.text, {
                projectDir: route.projectDir,
                onChunk: async (chunk, isToolUse) => {
                    const logPrefix = isToolUse ? "📤 [工具]" : "📤";
                    console.log(`${logPrefix} [${route.groupName}] Bot: ${chunk}`);
                    await sendReply(sdk, chatId, chunk);
                }
            });
        } catch (error: any) {
            console.error(`❌ 流式处理错误: ${error.message}`);
            await sendReply(sdk, chatId, `处理失败: ${error.message}`);
        }
    } else {
        // === 命令处理：使用原有 handler.handle() ===
        let result: HandleResult;
        try {
            result = await handler.handle(message.text, context);
        } catch (error: any) {
            console.error(`❌ 处理错误: ${error.message}`);
            result = {
                success: false,
                error: error.message,
            };
        }

        // 发送回复
        if (result.response) {
            console.log(`📤 [${route.groupName}] Bot: ${result.response}`);
            await sendReply(sdk, chatId, result.response);
        } else if (result.error) {
            console.error(`❌ 错误: ${result.error}`);
        }
    }

    // 标记消息为已读（防止重复处理）
    try {
        const fullChatId = chatId.includes(";") ? chatId : `any;+;${chatId}`;
        await execAsync(`osascript -e 'tell application "Messages" to set read of chat id "${fullChatId}" to true' 2>/dev/null`);
    } catch {
        // 忽略标记失败
    }
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

        const watcher = createWatcher({
            sdk,
            onNewMessage: handleMessageWrapper,
            onGroupMessage: handleMessageWrapper,
            debug,
        });

        await watcher.start().catch((error) => {
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
        return watcher;
    } else {
        // 使用 SDK 轮询模式
        console.log("🔄 使用轮询模式 (2s 间隔)\n");

        sdk.startWatching({
            onNewMessage: handleMessageWrapper,
            onGroupMessage: handleMessageWrapper,
        });

        // 启动定期检查未读消息（补充 SDK watcher 的不足）
        startPolling(sdk, debug, handleMessageWrapper);

        console.log("✅ 监听器已启动，等待消息...\n");
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
        await checkExistingMessages(sdk, debug, handler);
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

        if (unreadMessages.length > 0) {
            console.log(`📬 检测到 ${unreadMessages.length} 条未读消息，开始处理...`);
            for (const msg of unreadMessages) {
                await handler(msg);
                // 标记为已读（通过 AppleScript）
                try {
                    await execAsync(`osascript -e 'tell application "Messages" to set read of chat id "${msg.chatId || ""}" to true' 2>/dev/null`);
                } catch {
                    // 忽略标记失败
                }
            }
        }
    } catch (error: any) {
        if (debug) console.error("检查未读消息失败:", error.message);
    }
}
