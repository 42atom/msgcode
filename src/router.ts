/**
 * msgcode: 群组路由模块
 *
 * 根据 chatId 路由消息到对应的 Bot 处理器
 * 每个群组可以关联一个项目目录
 *
 * E08: 优先使用 RouteStore（动态绑定），fallback 到 GROUP_* 配置（静态配置）
 */

import { config, type GroupConfig } from "./config.js";
import { normalizeChatId, stableGroupNameForChatId } from "./channels/chat-id.js";
import { getRouteByChatId as getRouteFromStore } from "./routes/store.js";
import fs from "node:fs";
import path from "node:path";

/**
 * Bot 类型
 * P5.7-R9-T6: 新增 agent-backend 中性语义
 */
export type BotType = "code" | "image" | "file" | "lmstudio" | "agent-backend" | "default";

/**
 * E13: 模型客户端类型（本机可执行）
 * P5.7-R9-T6: 新增 agent-backend 中性语义
 */
export type ModelClient =
    | "agent-backend"
    | "lmstudio"
    | "minimax"
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

    // 未绑定：fallback 到默认工作目录（可配置），提升开箱即用体验
    // 允许 env 动态覆盖（测试隔离/临时切换）
    const workspaceRoot = process.env.WORKSPACE_ROOT
        ? path.resolve(process.env.WORKSPACE_ROOT)
        : config.workspaceRoot;
    const defaultDir = (process.env.MSGCODE_DEFAULT_WORKSPACE_DIR || "").trim() || config.defaultWorkspaceDir || "default";
    const workspacePath = path.resolve(workspaceRoot, defaultDir);
    try {
        if (!fs.existsSync(workspacePath)) {
            fs.mkdirSync(workspacePath, { recursive: true });
        }
    } catch {
        // ignore：创建失败不阻塞路由，但后续会在 handler 里报错（更可观测）
    }

    // default workspace 只保留为运行时临时 fallback。
    // 真实 route 必须来自显式 /bind 或静态配置，避免系统替用户永久做主。

    return {
        chatId, // 回复仍回到当前 chat
        groupName: stableGroupNameForChatId(chatId),
        projectDir: workspacePath,
        botType: "agent-backend",
    };
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
