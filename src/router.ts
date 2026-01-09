/**
 * msgcode: 群组路由模块
 *
 * 根据 chatId 路由消息到对应的 Bot 处理器
 * 每个群组可以关联一个项目目录
 */

import { config, type GroupConfig } from "./config.js";

/**
 * Bot 类型
 */
export type BotType = "code" | "image" | "file" | "default";

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
 * 归一化 chatId（提取核心部分用于匹配）
 */
function normalizeChatId(chatId: string): string {
    // 提取 GUID 部分（去掉 any;+; 或 any;-; 前缀）
    const parts = chatId.split(";");
    return parts[parts.length - 1];
}

/**
 * 根据 chatId 查找对应的群组配置
 */
export function routeByChatId(chatId: string): Route | null {
    const normalizedInput = normalizeChatId(chatId);

    // 遍历配置的群组路由
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
