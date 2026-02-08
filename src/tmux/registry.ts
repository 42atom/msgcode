/**
 * msgcode: Session Registry（P0: tmux 会话元数据落盘）
 *
 * 目的：让 msgcode 重启后依然"知道"每个 tmux 会话的执行臂/工作目录/状态
 *
 * - 落盘文件：~/.config/msgcode/sessions.json
 * - 原子写入：tmp -> fsync -> rename（避免 JSON 损坏）
 * - Fail-soft：registry 缺失/损坏时提示用户重建
 */

import { promises as fs } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { logger } from "../logger/index.js";
import type { RunnerTypeOld, RunnerType } from "./session.js";
import { normalizeRunnerType } from "./session.js";

// ============================================
// Schema
// ============================================

/**
 * 会话记录（v1）
 */
export interface SessionRecord {
  /** tmux 会话名称（主键，唯一） */
  sessionName: string;
  /** 群组名称 */
  groupName: string;
  /** 项目目录路径 */
  projectDir?: string;
  /** 执行臂类型（使用 RunnerTypeOld 兼容历史数据） */
  runner: RunnerTypeOld;
  /** 运行时分类（归一化后的值，可选，用于新数据） */
  runnerType?: "tmux" | "direct";
  /** 创建时间（毫秒时间戳） */
  createdAtMs: number;
  /** 更新时间（毫秒时间戳） */
  updatedAtMs: number;
  /** 最后启动时间（毫秒时间戳） */
  lastStartAtMs: number;
  /** 最后停止时间（毫秒时间戳） */
  lastStopAtMs: number;
}

/**
 * Registry 结构（v1）
 */
export interface SessionRegistry {
  /** Schema 版本 */
  version: 1;
  /** 最后更新时间（毫秒时间戳） */
  updatedAtMs: number;
  /** 会话记录列表 */
  sessions: SessionRecord[];
}

// ============================================
// 文件路径
// ============================================

/**
 * 获取 registry 文件路径
 */
function getRegistryPath(): string {
  return join(homedir(), ".config", "msgcode", "sessions.json");
}

/**
 * 获取 registry 临时文件路径（带进程ID和随机后缀，避免并发写冲突）
 */
function getTempRegistryPath(): string {
  const randomSuffix = Math.random().toString(36).slice(2, 10);
  return join(homedir(), ".config", "msgcode", `sessions.json.tmp.${process.pid}-${randomSuffix}`);
}

/**
 * 确保配置目录存在
 */
async function ensureConfigDir(): Promise<void> {
  const dir = join(homedir(), ".config", "msgcode");
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
  }
}

// ============================================
// 读写操作
// ============================================

/**
 * 读取 registry（fail-soft）
 *
 * - 文件不存在 → 返回空 registry
 * - JSON 损坏 → 返回空 registry
 * - 版本不匹配 → 返回空 registry（P0 只支持 v1）
 */
async function readRegistry(): Promise<SessionRegistry> {
  const filePath = getRegistryPath();

  try {
    const content = await fs.readFile(filePath, "utf-8");
    const registry = JSON.parse(content) as SessionRegistry;

    // 版本检查
    if (registry.version !== 1) {
      logger.warn("Registry 版本不匹配，将重新初始化", {
        module: "session-registry",
        version: registry.version,
      });
      return createEmptyRegistry();
    }

    return registry;
  } catch (error) {
    // 文件不存在或 JSON 解析失败
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      // 文件不存在，返回空 registry
      return createEmptyRegistry();
    }

    // JSON 损坏或其他错误
    logger.warn("Registry 读取失败，将重新初始化", {
      module: "session-registry",
      error: error instanceof Error ? error.message : String(error),
    });
    return createEmptyRegistry();
  }
}

/**
 * 创建空 registry
 */
function createEmptyRegistry(): SessionRegistry {
  return {
    version: 1,
    updatedAtMs: Date.now(),
    sessions: [],
  };
}

/**
 * 写入 registry（原子操作）
 *
 * 流程：写临时文件 -> rename（保证原子性）
 */
async function writeRegistry(registry: SessionRegistry): Promise<void> {
  await ensureConfigDir();

  const tempPath = getTempRegistryPath();
  const targetPath = getRegistryPath();

  try {
    // 1. 写入临时文件
    const content = JSON.stringify(registry, null, 2);
    await fs.writeFile(tempPath, content, "utf-8");

    // 2. 原子性 rename（rename 在 POSIX 上是原子操作）
    await fs.rename(tempPath, targetPath);
  } catch (error) {
    // 清理临时文件
    try {
      await fs.unlink(tempPath);
    } catch {
      // ignore
    }
    throw error;
  }
}

// ============================================
// CRUD 操作
// ============================================

/**
 * 校验 runnerType 是否有效，无效则返回 normalize 结果
 *
 * 守卫：防止坏数据把系统带偏
 */
function validateOrNormalizeRunnerType(record: SessionRecord): "tmux" | "direct" {
  // 优先使用 runnerType，但必须校验
  if (record.runnerType === "tmux" || record.runnerType === "direct") {
    return record.runnerType;
  }

  // runnerType 缺失或无效：fallback normalize
  return normalizeRunnerType(record.runner);
}

/**
 * 获取指定会话记录（归一化：确保 runnerType 字段有效）
 */
export async function getSession(sessionName: string): Promise<SessionRecord | null> {
  const registry = await readRegistry();
  const record = registry.sessions.find(s => s.sessionName === sessionName);
  if (!record) return null;

  // 读时迁移：校验 runnerType，无效则从 runner 推断
  const runnerType = validateOrNormalizeRunnerType(record);
  if (runnerType !== record.runnerType) {
    return { ...record, runnerType };
  }
  return record;
}

/**
 * 获取指定群组的会话记录（归一化：确保 runnerType 字段有效）
 */
export async function getSessionByGroupName(groupName: string): Promise<SessionRecord | null> {
  const registry = await readRegistry();
  const record = registry.sessions.find(s => s.groupName === groupName);
  if (!record) return null;

  // 读时迁移：校验 runnerType，无效则从 runner 推断
  const runnerType = validateOrNormalizeRunnerType(record);
  if (runnerType !== record.runnerType) {
    return { ...record, runnerType };
  }
  return record;
}

/**
 * 创建或更新会话记录（/start 时调用）
 *
 * - 更新现有记录时，保留 lastStopAtMs（不覆盖）
 * - 新建记录时，lastStopAtMs 初始化为 0
 * - 写入策略：双写 runner（旧）+ runnerType（新，强制 normalize）
 *
 * 守卫：runnerType 强制从 record.runner 推断，不信任外部传入
 */
export async function upsertSession(record: Omit<SessionRecord, "createdAtMs" | "updatedAtMs" | "lastStartAtMs" | "lastStopAtMs" | "runnerType">): Promise<void> {
  const registry = await readRegistry();
  const now = Date.now();

  const existingIndex = registry.sessions.findIndex(s => s.sessionName === record.sessionName);

  // 强制从 record.runner 推断 runnerType（守卫：不信任外部传入）
  const runnerType: "tmux" | "direct" = normalizeRunnerType(record.runner);

  if (existingIndex >= 0) {
    // 更新现有记录：保留 lastStopAtMs
    const existing = registry.sessions[existingIndex];
    registry.sessions[existingIndex] = {
      ...existing,
      ...record,
      runnerType,  // 双写：新字段（强制归一化）
      lastStartAtMs: now,
      updatedAtMs: now,
      // 保留现有的 lastStopAtMs，不被覆盖
    };
  } else {
    // 创建新记录：lastStopAtMs 初始化为 0
    registry.sessions.push({
      ...record,
      runnerType,  // 双写：新字段（强制归一化）
      createdAtMs: now,
      updatedAtMs: now,
      lastStartAtMs: now,
      lastStopAtMs: 0,
    });
  }

  registry.updatedAtMs = now;
  await writeRegistry(registry);
}

/**
 * 更新会话停止时间（/stop 时调用）
 */
export async function updateSessionStopTime(sessionName: string): Promise<void> {
  const registry = await readRegistry();
  const now = Date.now();

  const index = registry.sessions.findIndex(s => s.sessionName === sessionName);
  if (index >= 0) {
    registry.sessions[index].lastStopAtMs = now;
    registry.sessions[index].updatedAtMs = now;
    registry.updatedAtMs = now;
    await writeRegistry(registry);
  }
}

/**
 * 删除会话记录（暂时不用，P0 保留记录只更新时间）
 */
export async function deleteSession(sessionName: string): Promise<void> {
  const registry = await readRegistry();

  const beforeCount = registry.sessions.length;
  registry.sessions = registry.sessions.filter(s => s.sessionName !== sessionName);

  if (registry.sessions.length < beforeCount) {
    registry.updatedAtMs = Date.now();
    await writeRegistry(registry);
  }
}

/**
 * 获取所有会话记录
 */
export async function getAllSessions(): Promise<SessionRecord[]> {
  const registry = await readRegistry();
  return registry.sessions;
}
