/**
 * msgcode: 路由探针
 *
 * 检查绑定状态和工作目录
 */

import { promises as fs } from "node:fs";
import { getActiveRoutes } from "../../routes/store.js";
import { TmuxSession } from "../../tmux/session.js";
import { stableGroupNameForChatId } from "../../imsg/adapter.js";
import type { ProbeResult, ProbeOptions } from "../types.js";

/**
 * 路由探针
 */
export async function probeRoutes(options?: ProbeOptions): Promise<ProbeResult> {
    const details: Record<string, unknown> = {};
    const issues: string[] = [];

    // 获取所有活跃路由
    const routes = getActiveRoutes();
    details.active_routes_count = routes.length;

    if (routes.length === 0) {
        return {
            name: "routes",
            status: "warning",
            message: "暂无活跃绑定",
            details: { active_routes: [] },
        };
    }

    // 检查每个路由
    const routeDetails: unknown[] = [];
    let runningCount = 0;

    for (const route of routes) {
        const routeInfo: Record<string, unknown> = {
            label: route.label,
            workspace_path: route.workspacePath,
            bot_type: route.botType,
            created_at: route.createdAt,
            updated_at: route.updatedAt,
        };

        // 检查工作目录
        const dirExists = await fs.access(route.workspacePath, fs.constants.F_OK).then(() => true).catch(() => false);
        routeInfo.workspace_exists = dirExists;

        // 检查 tmux 会话状态
        try {
            const groupName = stableGroupNameForChatId(route.chatGuid);
            const exists = await TmuxSession.exists(groupName);
            routeInfo.tmux_running = exists;
            routeInfo.tmux_group = groupName;
            if (exists) runningCount++;
        } catch {
            routeInfo.tmux_running = false;
        }

        // 计算最后活动时间（从 updatedAt）
        const lastActivity = new Date(route.updatedAt);
        const minutesAgo = Math.floor((Date.now() - lastActivity.getTime()) / 60000);
        routeInfo.last_activity_minutes_ago = minutesAgo;

        routeDetails.push(routeInfo);

        if (!dirExists) {
            issues.push(`${route.label}: 工作目录不存在`);
        }
    }

    details.routes = routeDetails;
    details.tmux_running_count = runningCount;

    // 判断状态
    let status: ProbeResult["status"] = "pass";
    if (runningCount === 0 && routes.length > 0) {
        status = "warning";
        issues.push("所有 tmux 会话未运行");
    } else if (runningCount < routes.length) {
        status = "warning";
        issues.push(`${routes.length - runningCount}/${routes.length} 会话未运行`);
    }

    return {
        name: "routes",
        status,
        message: issues.length > 0 ? issues.join("; ") : `${routes.length} 个绑定正常`,
        details,
    };
}
