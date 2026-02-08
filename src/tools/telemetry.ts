/**
 * msgcode: Tool Bus 观测与统计（Telemetry）
 *
 * 职责：
 * - recordToolEvent(): 记录工具执行事件到内存 ring buffer
 * - getToolStats(): 获取时间窗口内的统计数据
 * - 错误码统一化（避免透传底层报错）
 *
 * P0: 内存存储，不落盘
 */

import { logger } from "../logger/index.js";

// ============================================
// 类型定义
// ============================================

/**
 * 工具执行事件
 */
export interface ToolEvent {
  /** 请求 ID */
  requestId: string;
  /** 工作区路径 */
  workspacePath: string;
  /** 会话 ID（可选） */
  chatId?: string;
  /** 工具名称 */
  tool: string;
  /** 调用源 */
  source: string;
  /** 耗时（毫秒） */
  durationMs: number;
  /** 是否成功 */
  ok: boolean;
  /** 错误码（失败时） */
  errorCode?: string;
  /** 产物路径列表 */
  artifactPaths: string[];
  /** 时间戳 */
  timestamp: number;
}

/**
 * 工具统计数据
 */
export interface ToolStats {
  /** 总调用数 */
  totalCalls: number;
  /** 成功数 */
  successCount: number;
  /** 失败数 */
  failureCount: number;
  /** 成功率 */
  successRate: number;
  /** 平均耗时（毫秒） */
  avgDurationMs: number;
  /** 各工具调用分布 */
  byTool: Record<string, { calls: number; successRate: number; avgMs: number }>;
  /** 错误码分布（Top N） */
  topErrorCodes: Array<{ code: string; count: number }>;
  /** 各调用源分布 */
  bySource: Record<string, number>;
}

// ============================================
// 配置常量
// ============================================

/** Ring buffer 最大容量 */
const MAX_EVENTS = 200;

/** 默认统计窗口（毫秒） */
const DEFAULT_STATS_WINDOW_MS = 3600000; // 1 小时

// ============================================
// 状态管理
// ============================================

/**
 * 事件 Ring Buffer
 */
class EventRingBuffer {
  private buffer: ToolEvent[] = [];
  private maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  /**
   * 添加事件
   */
  push(event: ToolEvent): void {
    this.buffer.push(event);
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift(); // 移除最旧的事件
    }
  }

  /**
   * 获取所有事件
   */
  getAll(): ToolEvent[] {
    return [...this.buffer];
  }

  /**
   * 获取时间窗口内的事件
   */
  getSince(timestamp: number): ToolEvent[] {
    const cutoff = Date.now() - timestamp;
    return this.buffer.filter(e => e.timestamp >= cutoff);
  }

  /**
   * 清空
   */
  clear(): void {
    this.buffer = [];
  }

  /**
   * 获取当前大小
   */
  size(): number {
    return this.buffer.length;
  }
}

/** 全局事件存储 */
const eventBuffer = new EventRingBuffer(MAX_EVENTS);

// ============================================
// 核心函数
// ============================================

/**
 * 记录工具执行事件
 *
 * @param event 工具执行事件
 */
export function recordToolEvent(event: ToolEvent): void {
  // 结构化日志（便于日志分析）
  const logLevel = event.ok ? "info" : "warn";
  logger[logLevel](
    `Tool Bus: ${event.ok ? "SUCCESS" : "FAILURE"} ${event.tool}`,
    {
      module: "tools-bus",
      requestId: event.requestId,
      workspacePath: event.workspacePath,
      chatId: event.chatId,
      tool: event.tool,
      source: event.source,
      durationMs: event.durationMs,
      ok: event.ok,
      errorCode: event.errorCode,
      artifactPaths: event.artifactPaths,
    }
  );

  // 存入 ring buffer
  eventBuffer.push(event);
}

/**
 * 获取统计数据
 *
 * @param windowMs 时间窗口（毫秒），默认 1 小时
 * @returns 工具统计数据
 */
export function getToolStats(windowMs: number = DEFAULT_STATS_WINDOW_MS): ToolStats {
  const events = eventBuffer.getSince(windowMs);

  if (events.length === 0) {
    return {
      totalCalls: 0,
      successCount: 0,
      failureCount: 0,
      successRate: 1,
      avgDurationMs: 0,
      byTool: {},
      topErrorCodes: [],
      bySource: {},
    };
  }

  const successEvents = events.filter(e => e.ok);
  const failureEvents = events.filter(e => !e.ok);

  // 按工具分组
  const byTool: Record<string, { calls: number; successCount: number; totalMs: number }> = {};
  for (const e of events) {
    if (!byTool[e.tool]) {
      byTool[e.tool] = { calls: 0, successCount: 0, totalMs: 0 };
    }
    byTool[e.tool].calls++;
    byTool[e.tool].totalMs += e.durationMs;
    if (e.ok) byTool[e.tool].successCount++;
  }

  // 按错误码分组
  const errorCodeCounts: Record<string, number> = {};
  for (const e of failureEvents) {
    const code = e.errorCode || "UNKNOWN";
    errorCodeCounts[code] = (errorCodeCounts[code] || 0) + 1;
  }

  // 按调用源分组
  const bySource: Record<string, number> = {};
  for (const e of events) {
    bySource[e.source] = (bySource[e.source] || 0) + 1;
  }

  // Top 错误码
  const topErrorCodes = Object.entries(errorCodeCounts)
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // 各工具统计
  const byToolStats: Record<string, { calls: number; successRate: number; avgMs: number }> = {};
  for (const [tool, data] of Object.entries(byTool)) {
    byToolStats[tool] = {
      calls: data.calls,
      successRate: data.calls > 0 ? data.successCount / data.calls : 0,
      avgMs: data.calls > 0 ? data.totalMs / data.calls : 0,
    };
  }

  const totalDurationMs = events.reduce((sum, e) => sum + e.durationMs, 0);

  return {
    totalCalls: events.length,
    successCount: successEvents.length,
    failureCount: failureEvents.length,
    successRate: successEvents.length / events.length,
    avgDurationMs: totalDurationMs / events.length,
    byTool: byToolStats,
    topErrorCodes,
    bySource,
  };
}

/**
 * 清空事件缓冲区（用于测试或调试）
 */
export function clearToolEvents(): void {
  eventBuffer.clear();
}

/**
 * 获取所有事件（用于调试）
 */
export function getAllToolEvents(): ToolEvent[] {
  return eventBuffer.getAll();
}
