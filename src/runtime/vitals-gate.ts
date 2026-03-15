/**
 * msgcode: Global Gate for Cross-Workspace Resource Contention
 *
 * 对齐 spec: docs/protocol/VITALS.md - Global Gate
 *
 * 职责：
 * - 跨 workspace 资源争用协调
 * - 文件锁实现，不依赖中心调度器
 * - claim 失败时返回 defer，不标记任务失败
 */

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { logger } from "../logger/index.js";

// ============================================
// Gate Configuration
// ============================================

export interface GateConfig {
  resource: string;
  workspacePath: string;
  taskId?: string;
}

interface GateLock {
  resource: string;
  workspacePath: string;
  taskId?: string;
  lockedAt: number;
  expiresAt: number;
}

/**
 * Global gates directory
 */
export function getGatesDir(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || "/tmp";
  const gatesDir = path.join(homeDir, ".config", "msgcode", "runtime", "gates");
  return gatesDir;
}

/**
 * Get lock file path for a resource
 */
function getGateLockPath(resource: string): string {
  const gatesDir = getGatesDir();
  return path.join(gatesDir, `${resource}.lock`);
}

/**
 * Ensure gates directory exists
 */
function ensureGatesDir(): void {
  const gatesDir = getGatesDir();
  if (!existsSync(gatesDir)) {
    mkdirSync(gatesDir, { recursive: true });
  }
}

function readGateLock(lockPath: string): GateLock | null {
  if (!existsSync(lockPath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(lockPath, "utf-8")) as GateLock;
  } catch {
    return null;
  }
}

function isExpiredGateLock(lock: GateLock): boolean {
  return Boolean(lock.expiresAt && Date.now() > lock.expiresAt);
}

function readActiveGateLock(lockPath: string): GateLock | null {
  const lock = readGateLock(lockPath);
  if (!lock || isExpiredGateLock(lock)) {
    return null;
  }
  return lock;
}

function clearGateLock(lockPath: string): boolean {
  try {
    unlinkSync(lockPath);
    return true;
  } catch (error: any) {
    return error?.code === "ENOENT";
  }
}

// ============================================
// Gate Operations
// ============================================

/**
 * Claim a gate (atomic file lock)
 *
 * Uses atomic file creation (O_EXCL) to ensure only one process can claim
 * @returns { acquired: boolean, reason?: string }
 */
export function claimGate(config: GateConfig): { acquired: boolean; reason?: string } {
  const { resource, workspacePath, taskId } = config;
  const lockPath = getGateLockPath(resource);

  ensureGatesDir();

  // Atomic claim using O_EXCL (exclusive create)
  // 'wx' flag = O_CREAT | O_EXCL - fails if file exists
  let fd: number | undefined;
  try {
    fd = openSync(lockPath, "wx");

    // We got the lock - write the lock file
    const lock: GateLock = {
      resource,
      workspacePath,
      taskId,
      lockedAt: Date.now(),
      expiresAt: Date.now() + 5 * 60 * 1000, // 5 minute default TTL
    };

    writeFileSync(fd, JSON.stringify(lock, null, 2));
    closeSync(fd);

    logger.info(`[Gate] Acquired`, { resource, workspacePath, taskId });
    return { acquired: true };
  } catch (error: any) {
    if (fd !== undefined) {
      try { closeSync(fd); } catch {}
    }

    // EEXIST means another process claimed it
    if (error.code === "EEXIST") {
      const activeLock = readActiveGateLock(lockPath);
      if (!activeLock) {
        if (!clearGateLock(lockPath)) {
          return { acquired: false, reason: "stale gate lock could not be cleared" };
        }
        return claimGate(config);
      }

      return {
        acquired: false,
        reason: `gate held by ${activeLock.workspacePath} for ${activeLock.taskId || "unknown task"}`,
      };
    }

    const errorMsg = error.message || String(error);
    logger.error(`[Gate] Failed to acquire`, { resource, error: errorMsg });
    return { acquired: false, reason: errorMsg };
  }
}

/**
 * Release a gate
 */
export function releaseGate(resource: string, workspacePath: string): boolean {
  const lockPath = getGateLockPath(resource);

  if (!existsSync(lockPath)) {
    return true; // Already released
  }

  try {
    const lock = readGateLock(lockPath);
    if (!lock) {
      return clearGateLock(lockPath);
    }

    // Only release if we own it
    if (lock.workspacePath === workspacePath) {
      clearGateLock(lockPath);
      logger.info(`[Gate] Released`, { resource, workspacePath });
      return true;
    } else {
      logger.warn(`[Gate] Cannot release - owned by another workspace`, {
        resource,
        workspacePath,
        owner: lock.workspacePath,
      });
      return false;
    }
  } catch (error) {
    // Lock file missing or corrupted, treat as released
    return true;
  }
}

/**
 * Check if a gate is available
 */
export function isGateAvailable(resource: string): boolean {
  const lockPath = getGateLockPath(resource);
  return readActiveGateLock(lockPath) === null;
}

/**
 * Check if a gate is available for a specific workspace
 *
 * Returns true if:
 * - No lock exists
 * - Lock is expired
 * - Current workspace owns the lock (own locks don't block)
 *
 * Returns false if:
 * - Another workspace holds the lock and it's not expired
 */
export function isGateAvailableForWorkspace(resource: string, workspacePath: string): boolean {
  const lockPath = getGateLockPath(resource);
  const lock = readActiveGateLock(lockPath);
  return lock === null || lock.workspacePath === workspacePath;
}

/**
 * Get gate status
 */
export function getGateStatus(resource: string): {
  available: boolean;
  holder?: { workspacePath: string; taskId?: string; lockedAt: number; expiresAt: number };
} {
  const lockPath = getGateLockPath(resource);
  const lock = readActiveGateLock(lockPath);
  if (!lock) {
    return { available: true };
  }

  return {
    available: false,
    holder: {
      workspacePath: lock.workspacePath,
      taskId: lock.taskId,
      lockedAt: lock.lockedAt,
      expiresAt: lock.expiresAt,
    },
  };
}

/**
 * List all gates
 */
export function listGates(): { resource: string; available: boolean; holder?: string }[] {
  const gatesDir = getGatesDir();
  const resources = ["llm-tokens", "browser", "desktop"];

  return resources.map((resource) => {
    const status = getGateStatus(resource);
    return {
      resource,
      available: status.available,
      holder: status.holder?.workspacePath,
    };
  });
}

/**
 * Force release a gate (for testing/cleanup only)
 *
 * WARNING: This bypasses ownership check, use with caution
 */
export function forceReleaseGate(resource: string): boolean {
  const lockPath = getGateLockPath(resource);

  if (!existsSync(lockPath)) {
    return true;
  }

  try {
    unlinkSync(lockPath);
    logger.info(`[Gate] Force released`, { resource });
    return true;
  } catch (error) {
    return false;
  }
}
