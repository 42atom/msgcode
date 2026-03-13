/**
 * msgcode: Desktop 会话证据映射
 * Batch-T3 (P1): Message 请求与 desktop 证据目录关联
 *
 * 职责：
 * - 记录 Message 请求到 desktop execution 的映射
 * - 落盘 NDJSON: messageRequestId, method, executionId, evidenceDir, ts
 * - 支持抽样追溯验证
 */

import { promises as fs } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Desktop 会话记录
 */
export interface DesktopSessionRecord {
  /** Message 请求 ID（来自 user message） */
  messageRequestId: string;
  /** Desktop 方法名（如 click, typeText, hotkey, observe） */
  method: string;
  /** Desktop execution ID（从返回结果提取） */
  executionId: string;
  /** Evidence 目录路径 */
  evidenceDir: string;
  /** 时间戳（ISO 8601） */
  ts: string;
  /** 工作区路径 */
  workspacePath: string;
  /** Chat ID（用于追溯来源） */
  chatId: string;
}

/**
 * 会话证据映射存储
 */
class DesktopSessionStore {
  private records: Map<string, DesktopSessionRecord[]> = new Map();
  private workspacePath: string;

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
  }

  /**
   * 获取会话记录文件路径
   */
  private getLogPath(): string {
    return join(this.workspacePath, ".msgcode", "desktop_sessions.ndjson");
  }

  /**
   * 记录一次 desktop 会话
   */
  async record(record: DesktopSessionRecord): Promise<void> {
    // 内存存储
    const records = this.records.get(record.messageRequestId) || [];
    records.push(record);
    this.records.set(record.messageRequestId, records);

    // 落盘 NDJSON
    const logPath = this.getLogPath();
    try {
      // 确保目录存在
      const logDir = join(logPath, "..");
      await fs.mkdir(logDir, { recursive: true });

      // 追加写入
      const line = JSON.stringify(record) + "\n";
      await fs.appendFile(logPath, line, "utf8");
    } catch (error) {
      // 落盘失败不影响主流程，只记录错误
      console.error(`[DesktopSessionStore] 落盘失败: ${error}`);
    }
  }

  /**
   * 获取所有会话记录
   */
  getAll(): DesktopSessionRecord[] {
    const all: DesktopSessionRecord[] = [];
    for (const records of this.records.values()) {
      all.push(...records);
    }
    return all.sort((a, b) => a.ts.localeCompare(b.ts));
  }

  /**
   * 根据 messageRequestId 获取记录
   */
  getByMessageRequestId(messageRequestId: string): DesktopSessionRecord[] {
    return this.records.get(messageRequestId) || [];
  }

  /**
   * 根据 executionId 获取记录
   */
  getByExecutionId(executionId: string): DesktopSessionRecord | undefined {
    for (const records of this.records.values()) {
      const found = records.find(r => r.executionId === executionId);
      if (found) return found;
    }
    return undefined;
  }

  /**
   * 验证证据目录是否存在（用于抽样追溯）
   */
  async verifyEvidenceDir(record: DesktopSessionRecord): Promise<boolean> {
    try {
      await fs.access(record.evidenceDir);
      return true;
    } catch {
      return false;
    }
  }
}

// ============================================
// 单例存储（按 workspace 分隔）
// ============================================

const stores = new Map<string, DesktopSessionStore>();

/**
 * 获取指定 workspace 的会话存储
 */
export function getDesktopSessionStore(workspacePath: string): DesktopSessionStore {
  if (!stores.has(workspacePath)) {
    stores.set(workspacePath, new DesktopSessionStore(workspacePath));
  }
  return stores.get(workspacePath)!;
}

/**
 * 生成新的 messageRequestId
 */
export function generateMessageRequestId(): string {
  return randomUUID();
}

/**
 * 记录 desktop 会话（便捷函数）
 */
export async function recordDesktopSession(params: {
  messageRequestId: string;
  method: string;
  executionId: string;
  evidenceDir: string;
  workspacePath: string;
  chatId: string;
}): Promise<void> {
  const store = getDesktopSessionStore(params.workspacePath);
  await store.record({
    messageRequestId: params.messageRequestId,
    method: params.method,
    executionId: params.executionId,
    evidenceDir: params.evidenceDir,
    ts: new Date().toISOString(),
    workspacePath: params.workspacePath,
    chatId: params.chatId,
  });
}

/**
 * 抽样验证会话记录（用于回归测试）
 */
export async function sampleVerifyDesktopSessions(
  workspacePath: string,
  sampleSize: number = 5
): Promise<{
  total: number;
  sampled: number;
  verified: number;
  failed: Array<{ record: DesktopSessionRecord; error: string }>;
}> {
  const store = getDesktopSessionStore(workspacePath);
  const allRecords = store.getAll();

  // 采样最近的 N 条记录
  const sampledRecords = allRecords.slice(-sampleSize);
  const failed: Array<{ record: DesktopSessionRecord; error: string }> = [];

  for (const record of sampledRecords) {
    const exists = await store.verifyEvidenceDir(record);
    if (!exists) {
      failed.push({ record, error: "evidence directory not found" });
    }
  }

  return {
    total: allRecords.length,
    sampled: sampledRecords.length,
    verified: sampledRecords.length - failed.length,
    failed,
  };
}
