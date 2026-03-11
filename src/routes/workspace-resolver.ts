/**
 * msgcode: 命令域 workspace 解析器
 *
 * 目标：
 * - 命令链路与消息链路共用同一套 workspace 解析口径
 * - 优先使用显式 /bind 路由
 * - 未显式绑定时，回落到 router.ts 的默认 workspace fallback
 */

import type { RouteEntry } from "./store.js";
import { getRouteByChatId } from "./store.js";
import { routeByChatId } from "../router.js";

export interface ResolvedCommandRoute {
  route: RouteEntry;
  explicitBinding: boolean;
}

export function resolveCommandRoute(chatId: string): ResolvedCommandRoute | null {
  const explicitEntry = getRouteByChatId(chatId);
  if (explicitEntry) {
    return {
      route: explicitEntry,
      explicitBinding: true,
    };
  }

  const fallback = routeByChatId(chatId);
  if (!fallback?.projectDir) {
    return null;
  }

  return {
    explicitBinding: false,
    route: {
      chatGuid: fallback.chatId,
      workspacePath: fallback.projectDir,
      botType: fallback.botType ?? "agent-backend",
      status: "active",
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    },
  };
}
