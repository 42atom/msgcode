/**
 * msgcode: CLI 命令运行器公共函数
 *
 * P5.6.9-R1: 抽取公共 Envelope 和路径解析
 *
 * 职责：
 * - createEnvelope: 创建 CLI 响应信封（Envelope）
 * - getWorkspacePath: 解析工作区路径
 */

import { randomUUID } from "node:crypto";
import { isAbsolute, join, resolve } from "node:path";
import type { Envelope, Diagnostic } from "../memory/types.js";

// ============================================
// Envelope 工厂
// ============================================

/**
 * 创建 Envelope
 *
 * @param command 命令字符串
 * @param startTime 开始时间（毫秒）
 * @param status 状态：pass | warning | error
 * @param data 响应数据
 * @param warnings 警告列表
 * @param errors 错误列表
 * @returns Envelope 对象
 */
export function createEnvelope<T>(
  command: string,
  startTime: number,
  status: "pass" | "warning" | "error",
  data: T,
  warnings: Diagnostic[] = [],
  errors: Diagnostic[] = []
): Envelope<T> {
  const summary = {
    warnings: warnings.length,
    errors: errors.length,
  };

  const exitCode = status === "error" ? 1 : status === "warning" ? 2 : 0;
  const durationMs = Date.now() - startTime;

  return {
    schemaVersion: 2,
    command,
    requestId: randomUUID(),
    timestamp: new Date().toISOString(),
    durationMs,
    status,
    exitCode,
    summary,
    data,
    warnings,
    errors,
  };
}

// ============================================
// 路径解析
// ============================================

/**
 * 获取工作区路径
 *
 * @param label 工作区标签或路径
 * @returns 绝对路径
 */
export function getWorkspacePath(label: string): string {
  const workspaceRoot = process.env.WORKSPACE_ROOT || join(process.env.HOME || "", "msgcode-workspaces");
  const raw = String(label || "").trim();
  if (!raw) return join(workspaceRoot, raw);
  if (raw === "~") return process.env.HOME ? process.env.HOME : raw;
  if (raw.startsWith("~/")) return process.env.HOME ? join(process.env.HOME, raw.slice(2)) : raw;
  if (isAbsolute(raw)) return resolve(raw);
  return join(workspaceRoot, raw);
}
