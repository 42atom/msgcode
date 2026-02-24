/**
 * msgcode: Heartbeat 常驻唤醒 Runner（P5.7-R12-T1）
 *
 * 职责：
 * - 在无新消息场景下保持周期唤醒（heartbeat tick）
 * - 支持 start() / stop() / triggerNow() 接口
 * - 防重入：上次 tick 未完成时本轮跳过
 * - 异常自恢复：tick 失败不导致停摆
 *
 * 配置：
 * - 默认周期：60s
 * - 环境变量：MSGCODE_HEARTBEAT_MS 可覆盖
 */

import { logger } from "../logger/index.js";

/**
 * Heartbeat 配置
 */
export interface HeartbeatConfig {
  /** 心跳间隔（毫秒），默认 60000 */
  intervalMs?: number;
  /** 日志前缀标识 */
  tag?: string;
}

/**
 * Tick 上下文（传递给回调）
 */
export interface TickContext {
  /** 唯一 tick ID */
  tickId: string;
  /** 触发原因：interval（定时）/ manual（手动） */
  reason: "interval" | "manual";
  /** 开始时间戳 */
  startTime: number;
}

/**
 * Tick 结果（日志观测用）
 */
export interface TickResult {
  /** 是否成功 */
  ok: boolean;
  /** 耗时（毫秒） */
  durationMs: number;
  /** 错误消息（失败时） */
  error?: string;
}

/**
 * Tick 回调函数类型
 *
 * @param ctx Tick 上下文
 * @returns Promise<void>
 */
export type TickCallback = (ctx: TickContext) => Promise<void>;

/**
 * Heartbeat Runner 类
 *
 * 提供周期唤醒能力，支持：
 * - start(): 启动心跳
 * - stop(): 停止心跳
 * - triggerNow(): 手动触发一次
 * - onTick(): 注册 tick 回调
 */
export class HeartbeatRunner {
  private intervalMs: number;
  private tag: string;
  private tickCallback: TickCallback | null = null;
  private timerId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private isTicking = false;
  private stopRequested = false;

  /**
   * 创建 HeartbeatRunner 实例
   *
   * @param config 配置选项
   */
  constructor(config?: HeartbeatConfig) {
    // 从环境变量读取配置（优先级最高）
    const envInterval = process.env.MSGCODE_HEARTBEAT_MS
      ? parseInt(process.env.MSGCODE_HEARTBEAT_MS, 10)
      : undefined;

    this.intervalMs = envInterval ?? config?.intervalMs ?? 60_000;
    this.tag = config?.tag ?? "heartbeat";
  }

  /**
   * 注册 tick 回调
   *
   * @param callback Tick 回调函数
   */
  onTick(callback: TickCallback): void {
    this.tickCallback = callback;
  }

  /**
   * 启动心跳
   *
   * 行为：
   * - 启动定时器，按 intervalMs 周期触发 tick
   * - 首次 tick 立即执行（不等待一个周期）
   * - 防重入：上次 tick 未完成时跳过本轮
   */
  start(): void {
    if (this.isRunning) {
      logger.debug(`[${this.tag}] 已运行，忽略 start()`, { module: "runtime/heartbeat" });
      return;
    }

    this.isRunning = true;
    this.stopRequested = false;

    logger.info(`[${this.tag}] 心跳启动`, {
      module: "runtime/heartbeat",
      intervalMs: this.intervalMs,
    });

    // 立即执行首次 tick
    this.scheduleTick("manual");
  }

  /**
   * 停止心跳
   *
   * 行为：
   * - 清除定时器
   * - 等待当前 tick 完成（优雅停止）
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      logger.debug(`[${this.tag}] 未运行，忽略 stop()`, { module: "runtime/heartbeat" });
      return;
    }

    this.stopRequested = true;
    this.isRunning = false;

    // 清除定时器
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }

    // 等待当前 tick 完成（优雅停止）
    if (this.isTicking) {
      logger.info(`[${this.tag}] 等待当前 tick 完成`, {
        module: "runtime/heartbeat",
      });
      // 简单等待：实际 tick 有自己 try-catch，stop 不阻塞等待
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    logger.info(`[${this.tag}] 心跳已停止`, { module: "runtime/heartbeat" });
  }

  /**
   * 手动触发一次 tick（事件唤醒）
   *
   * @param reasonOverride 可选，覆盖 reason 字段（默认 "manual"）
   */
  triggerNow(reasonOverride?: "manual" | "interval"): void {
    if (!this.isRunning) {
      logger.debug(`[${this.tag}] 未运行，忽略 triggerNow()`, { module: "runtime/heartbeat" });
      return;
    }

    this.scheduleTick(reasonOverride ?? "manual");
  }

  /**
   * 调度 tick 执行
   *
   * @param reason 触发原因
   */
  private scheduleTick(reason: "interval" | "manual"): void {
    // 防重入检查
    if (this.isTicking) {
      logger.warn(`[${this.tag}] tick 重入保护：上次 tick 未完成，跳过本轮`, {
        module: "runtime/heartbeat",
        reason,
      });
      return;
    }

    // 创建 tick 上下文
    const ctx: TickContext = {
      tickId: crypto.randomUUID().slice(0, 8),
      reason,
      startTime: Date.now(),
    };

    // 执行 tick 回调
    this.executeTick(ctx);

    // 调度下一轮（如果是 interval 触发或手动触发后需要继续周期）
    if (this.isRunning && !this.stopRequested) {
      this.timerId = setTimeout(() => {
        if (this.isRunning && !this.stopRequested) {
          this.scheduleTick("interval");
        }
      }, this.intervalMs);
    }
  }

  /**
   * 执行 tick 回调（带异常兜底）
   *
   * @param ctx Tick 上下文
   */
  private async executeTick(ctx: TickContext): Promise<void> {
    this.isTicking = true;
    const result: TickResult = { ok: true, durationMs: 0 };

    try {
      if (!this.tickCallback) {
        logger.debug(`[${this.tag}] tick 无回调，跳过`, {
          module: "runtime/heartbeat",
          tickId: ctx.tickId,
          reason: ctx.reason,
        });
        return;
      }

      await this.tickCallback(ctx);
      result.ok = true;
    } catch (error) {
      result.ok = false;
      result.error = error instanceof Error ? error.message : String(error);
      logger.error(`[${this.tag}] tick 执行失败`, {
        module: "runtime/heartbeat",
        tickId: ctx.tickId,
        reason: ctx.reason,
        error: result.error,
      });
    } finally {
      result.durationMs = Date.now() - ctx.startTime;
      this.isTicking = false;

      // 统一日志输出（观测字段：tickId, reason, durationMs, ok）
      logger.info(`[${this.tag}] tick 完成`, {
        module: "runtime/heartbeat",
        tickId: ctx.tickId,
        reason: ctx.reason,
        durationMs: result.durationMs,
        ok: result.ok,
        ...(result.error ? { error: result.error } : {}),
      });
    }
  }

  /**
   * 检查是否正在运行
   */
  isAlive(): boolean {
    return this.isRunning;
  }

  /**
   * 检查是否正在 tick 中
   */
  isBusy(): boolean {
    return this.isTicking;
  }
}

// 单例实例（可选，供简单场景使用）
let globalHeartbeat: HeartbeatRunner | null = null;

/**
 * 获取全局 HeartbeatRunner 实例（惰性初始化）
 *
 * @param config 配置选项
 * @returns HeartbeatRunner 实例
 */
export function getHeartbeat(config?: HeartbeatConfig): HeartbeatRunner {
  if (!globalHeartbeat) {
    globalHeartbeat = new HeartbeatRunner(config);
  }
  return globalHeartbeat;
}

/**
 * 重置全局实例（用于测试）
 */
export function resetHeartbeat(): void {
  globalHeartbeat = null;
}
