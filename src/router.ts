/**
 * msgcode: 群组路由模块
 *
 * 根据 chatId 路由消息到对应的 Bot 处理器
 * 每个群组可以关联一个项目目录
 *
 * E08: 优先使用 RouteStore（动态绑定），fallback 到 GROUP_* 配置（静态配置）
 */

import { config, type GroupConfig } from "./config.js";
import { normalizeChatId, stableGroupNameForChatId } from "./imsg/adapter.js";
import { getRouteByChatId as getRouteFromStore } from "./routes/store.js";

/**
 * Bot 类型
 */
export type BotType = "code" | "image" | "file" | "lmstudio" | "default";

/**
 * E13: 模型客户端类型（本机可执行）
 */
export type ModelClient =
    | "mlx"
    | "lmstudio"
    | "llama"
    | "claude"
    | "openai"
    | "codex"
    | "claude-code"
    | "opencode";

/**
 * 路由结果
 */
export interface Route {
    chatId: string;
    groupName: string;
    projectDir?: string;
    botType?: BotType;
}

/**
 * 根据 chatId 查找对应的群组配置
 *
 * E08: 优先使用 RouteStore（动态绑定），fallback 到 GROUP_* 配置（静态配置）
 */
export function routeByChatId(chatId: string): Route | null {
    // 优先查询 RouteStore（动态绑定）
    const storeRoute = getRouteFromStore(chatId);
    if (storeRoute && storeRoute.status === "active") {
        return {
            chatId: storeRoute.chatGuid,
            groupName: stableGroupNameForChatId(storeRoute.chatGuid),
            projectDir: storeRoute.workspacePath,
            botType: storeRoute.botType,
        };
    }

    // Fallback 到 GROUP_* 配置（静态配置，不破现网）
    const normalizedInput = normalizeChatId(chatId);
    for (const [name, groupConfig] of config.groupRoutes.entries()) {
        const normalizedConfig = normalizeChatId(groupConfig.chatId);
        if (normalizedConfig === normalizedInput) {
            return {
                chatId: groupConfig.chatId,
                groupName: name,
                projectDir: groupConfig.projectDir,
                botType: (groupConfig.botType as BotType) || "default",
            };
        }
    }

    return null;
}

/**
 * 获取所有已配置的群组
 */
export function getAllRoutes(): Route[] {
    const routes: Route[] = [];

    for (const [name, groupConfig] of config.groupRoutes.entries()) {
        routes.push({
            chatId: groupConfig.chatId,
            groupName: name,
            projectDir: groupConfig.projectDir,
        });
    }

    return routes;
}

/**
 * 检查 chatId 是否已配置
 */
export function isConfiguredChatId(chatId: string): boolean {
    return routeByChatId(chatId) !== null;
}
