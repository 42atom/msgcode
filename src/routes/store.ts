/**
 * msgcode: RouteStore 模块
 *
 * 管理群组到工作空间的持久化映射
 * 文件位置: ~/.config/msgcode/routes.json
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { config } from "../config.js";
import { normalizeChatId } from "../imsg/adapter.js";
import type { BotType, ModelClient } from "../router.js";

// ============================================
// 类型定义
// ============================================

/**
 * 单个路由条目
 */
export interface RouteEntry {
  /** 完整 chatGuid (如 any;+;xxx 或 i chat;+;xxx) */
  chatGuid: string;
  /** 可选缓存：归一化 chatId 用于快速匹配 */
  chatId?: string;
  /** 工作目录绝对路径 */
  workspacePath: string;
  /** 可选的友好名称（如 'acme/ops'） */
  label?: string;
  /** Bot 类型 */
  botType: BotType;
  /** E13: 模型客户端（本机可执行） */
  modelClient?: "claude" | "codex" | "opencode";
  /** 绑定状态 */
  status: "active" | "archived" | "paused";
  /** ISO 8601 创建时间 */
  createdAt: string;
  /** ISO 8601 更新时间 */
  updatedAt: string;
}

/**
 * RouteStore 结构
 */
export interface RouteStoreData {
  /** Schema 版本号 */
  version: 1;
  /** 主键为 chatGuid，值为路由配置 */
  routes: Record<string, RouteEntry>;
}

// ============================================
// 常量
// ============================================

/**
 * 临时文件后缀（用于原子写入）
 */
const TEMP_FILE_SUFFIX = ".tmp";

/**
 * 获取 routes.json 文件路径
 * 支持通过环境变量 ROUTES_FILE_PATH 覆盖（用于测试）
 */
function getRoutesFilePath(): string {
  return process.env.ROUTES_FILE_PATH || path.join(os.homedir(), ".config/msgcode/routes.json");
}

// ============================================
// 辅助函数
// ============================================

/**
 * 获取工作空间根目录
 *
 * E16: 优先使用 config.workspaceRoot，但支持环境变量动态覆盖（测试兼容）
 */
function getWorkspaceRoot(): string {
  // 如果环境变量显式设置，优先使用（支持测试隔离）
  if (process.env.WORKSPACE_ROOT) {
    return path.resolve(process.env.WORKSPACE_ROOT);
  }
  // 否则使用 config 统一配置
  return config.workspaceRoot;
}

/**
 * 解析相对路径为绝对路径（相对于 WORKSPACE_ROOT）
 */
function resolveWorkspacePath(relativePath: string): string {
  const workspaceRoot = getWorkspaceRoot();
  const resolved = path.resolve(workspaceRoot, relativePath);

  // E16: 使用 path.relative 检查越界（更可靠）
  const relative = path.relative(workspaceRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`路径安全错误：路径必须在 ${workspaceRoot} 下`);
  }

  return resolved;
}

// ============================================
// RouteStore API
// ============================================

/**
 * 加载 RouteStore
 *
 * 如果文件不存在，返回空的 RouteStore
 */
export function loadRoutes(): RouteStoreData {
  if (!fs.existsSync(getRoutesFilePath())) {
    return {
      version: 1,
      routes: {},
    };
  }

  try {
    const content = fs.readFileSync(getRoutesFilePath(), "utf8");
    const data = JSON.parse(content) as RouteStoreData;

    // 版本检查
    if (data.version !== 1) {
      throw new Error(`不支持的 RouteStore 版本: ${data.version}`);
    }

    // 修复：历史/手工编辑导致的时间字段损坏（例如 "2026-01-28T18:48:45.3NZ"）
    // 原则：尽量自愈并落盘，避免 /where 出现 "Invalid Date"
    const now = new Date().toISOString();
    let changed = false;
    for (const [chatGuid, entry] of Object.entries(data.routes || {})) {
      if (!entry) continue;

      const createdOk = Number.isFinite(Date.parse(entry.createdAt));
      const updatedOk = Number.isFinite(Date.parse(entry.updatedAt));

      if (!createdOk) {
        entry.createdAt = now;
        changed = true;
      }

      if (!updatedOk) {
        entry.updatedAt = createdOk ? entry.createdAt : now;
        changed = true;
      }

      // 兜底：确保 chatGuid key 与 entry.chatGuid 一致
      if (entry.chatGuid !== chatGuid) {
        entry.chatGuid = chatGuid;
        changed = true;
      }
    }

    if (changed) {
      saveRoutes(data);
    }

    return data;
  } catch (error) {
    throw new Error(`加载 RouteStore 失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 保存 RouteStore（原子写入）
 *
 * 使用临时文件 + mv 重命名保证原子性
 */
export function saveRoutes(data: RouteStoreData): void {
  const tempPath = getRoutesFilePath() + TEMP_FILE_SUFFIX;

  try {
    // 确保目录存在
    const dir = path.dirname(getRoutesFilePath());
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // 写入临时文件
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf8");

    // 原子重命名
    fs.renameSync(tempPath, getRoutesFilePath());
  } catch (error) {
    // 清理临时文件
    if (fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // 忽略清理错误
      }
    }

    throw new Error(`保存 RouteStore 失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 根据 chatId 查找路由
 *
 * 支持完整 chatGuid、归一化 chatId 或后缀匹配（兼容 imsg RPC 短 ID）
 */
export function getRouteByChatId(chatId: string): RouteEntry | null {
  const data = loadRoutes();
  const normalized = normalizeChatId(chatId);

  // 优先精确匹配 chatGuid
  if (data.routes[chatId]) {
    return data.routes[chatId];
  }

  // 归一化匹配
  for (const entry of Object.values(data.routes)) {
    if (entry.chatId === normalized || entry.chatGuid === chatId) {
      return entry;
    }
  }

  // 后缀匹配（兼容 imsg RPC 返回的短 ID，如 953e31）
  const suffix = normalized.slice(-8); // 取后 8 位
  for (const entry of Object.values(data.routes)) {
    const entryNormalized = entry.chatGuid ? normalizeChatId(entry.chatGuid) : "";
    if (entryNormalized.slice(-8) === suffix || entryNormalized.endsWith(normalized)) {
      return entry;
    }
  }

  return null;
}

/**
 * 设置路由
 *
 * 如果 chatGuid 已存在，更新；否则新增
 */
export function setRoute(chatGuid: string, entry: RouteEntry): void {
  const data = loadRoutes();

  data.routes[chatGuid] = {
    ...entry,
    chatGuid,
    updatedAt: new Date().toISOString(),
  };

  saveRoutes(data);
}

/**
 * 删除路由
 */
export function deleteRoute(chatGuid: string): void {
  const data = loadRoutes();

  if (data.routes[chatGuid]) {
    delete data.routes[chatGuid];
    saveRoutes(data);
  }
}

/**
 * 创建新的路由绑定
 *
 * @param chatGuid - 完整 chatGuid
 * @param relativePath - 相对路径（相对于 WORKSPACE_ROOT）
 * @param options - 可选参数
 * @returns 创建的路由条目
 */
export function createRoute(
  chatGuid: string,
  relativePath: string,
  options?: {
    label?: string;
    botType?: BotType;
    modelClient?: ModelClient;
  }
): RouteEntry {
  // 解析路径
  const workspacePath = resolveWorkspacePath(relativePath);

  // 创建目录（如果不存在）
  if (!fs.existsSync(workspacePath)) {
    fs.mkdirSync(workspacePath, { recursive: true });
  }

  const now = new Date().toISOString();
  const entry: RouteEntry = {
    chatGuid,
    chatId: normalizeChatId(chatGuid),
    workspacePath,
    label: options?.label || relativePath,
    botType: options?.botType || "default",
    modelClient: options?.modelClient,
    status: "active",
    createdAt: now,
    updatedAt: now,
  };

  setRoute(chatGuid, entry);

  return entry;
}

/**
 * 更新路由状态
 */
export function updateRouteStatus(chatGuid: string, status: RouteEntry["status"]): void {
  const entry = getRouteByChatId(chatGuid);
  if (!entry) {
    throw new Error(`路由不存在: ${chatGuid}`);
  }

  const data = loadRoutes();
  if (data.routes[entry.chatGuid]) {
    data.routes[entry.chatGuid].status = status;
    data.routes[entry.chatGuid].updatedAt = new Date().toISOString();
    saveRoutes(data);
  }
}

/**
 * 获取所有活跃路由
 */
export function getActiveRoutes(): RouteEntry[] {
  const data = loadRoutes();
  return Object.values(data.routes).filter((r) => r.status === "active");
}

/**
 * 导出：获取工作空间根目录（供外部使用）
 */
export function getWorkspaceRootForDisplay(): string {
  return getWorkspaceRoot();
}
