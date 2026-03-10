/**
 * msgcode: 模型服务生命周期管理（P5.7-R12-T7）
 *
 * 目标：
 * - 统一管理“最后一次使用后空闲释放”策略
 * - 默认空闲 10 分钟释放，可通过环境变量覆盖
 * - 观测字段稳定输出，便于验收与排障
 */

import { logger } from "../logger/index.js";

/**
 * 默认模型服务空闲阈值：10 分钟
 */
export const DEFAULT_MODEL_SERVICE_IDLE_TTL_MS = 600_000;
export const LOCAL_MODEL_LOAD_MAX_RETRIES = 2;
export const DEFAULT_LOCAL_MODEL_RETRY_DELAY_MS = 3_000;

/**
 * 释放原因
 */
export type ModelServiceReleaseReason = "idle-timeout" | "manual-stop";

/**
 * 服务快照（供测试与诊断）
 */
export interface ModelServiceLeaseSnapshot {
  serviceName: string;
  lastUsedAt: number;
  idleMs: number;
  inFlight: number;
  released: boolean;
}

/**
 * 内部状态
 */
interface ModelServiceLeaseState {
  serviceName: string;
  lastUsedAt: number;
  inFlight: number;
  released: boolean;
  timer: NodeJS.Timeout | null;
  releaseAction?: () => Promise<void> | void;
}

/**
 * 解析模型服务空闲阈值
 *
 * 优先级：
 * 1. MSGCODE_MODEL_IDLE_MS
 * 2. 默认 600000
 */
export function resolveModelServiceIdleTtlMs(): number {
  const raw = process.env.MSGCODE_MODEL_IDLE_MS?.trim();
  if (!raw) return DEFAULT_MODEL_SERVICE_IDLE_TTL_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MODEL_SERVICE_IDLE_TTL_MS;
  }
  return Math.floor(parsed);
}

/**
 * 模型服务 lease 管理器
 */
export class ModelServiceLeaseManager {
  private readonly states = new Map<string, ModelServiceLeaseState>();
  private readonly idleTtlMs: number;
  private readonly nowFn: () => number;

  constructor(options?: { idleTtlMs?: number; nowFn?: () => number }) {
    this.idleTtlMs = options?.idleTtlMs ?? resolveModelServiceIdleTtlMs();
    this.nowFn = options?.nowFn ?? (() => Date.now());
  }

  /**
   * 使用服务（自动处理 in-flight + touch + 定时释放）
   */
  async withService<T>(
    serviceName: string,
    run: () => Promise<T>,
    releaseAction?: () => Promise<void> | void
  ): Promise<T> {
    const state = this.ensureState(serviceName, releaseAction);
    state.inFlight += 1;
    state.lastUsedAt = this.nowFn();
    state.released = false;

    try {
      return await run();
    } finally {
      state.inFlight = Math.max(0, state.inFlight - 1);
      state.lastUsedAt = this.nowFn();
      this.scheduleRelease(state);
    }
  }

  /**
   * 手动 touch（无需 in-flight，适用于轻量访问）
   */
  touch(serviceName: string, releaseAction?: () => Promise<void> | void): void {
    const state = this.ensureState(serviceName, releaseAction);
    state.lastUsedAt = this.nowFn();
    state.released = false;
    this.scheduleRelease(state);
  }

  /**
   * 获取服务快照
   */
  getSnapshot(serviceName: string): ModelServiceLeaseSnapshot | undefined {
    const state = this.states.get(serviceName);
    if (!state) return undefined;
    return {
      serviceName: state.serviceName,
      lastUsedAt: state.lastUsedAt,
      idleMs: Math.max(0, this.nowFn() - state.lastUsedAt),
      inFlight: state.inFlight,
      released: state.released,
    };
  }

  /**
   * 停止并清理所有计时器（测试/进程回收用）
   */
  async stopAll(reason: ModelServiceReleaseReason = "manual-stop"): Promise<void> {
    const states = Array.from(this.states.values());
    for (const state of states) {
      if (state.timer) {
        clearTimeout(state.timer);
        state.timer = null;
      }
      await this.releaseState(state, reason);
    }
  }

  private ensureState(
    serviceName: string,
    releaseAction?: () => Promise<void> | void
  ): ModelServiceLeaseState {
    const existing = this.states.get(serviceName);
    if (existing) {
      if (releaseAction) existing.releaseAction = releaseAction;
      return existing;
    }

    const now = this.nowFn();
    const created: ModelServiceLeaseState = {
      serviceName,
      lastUsedAt: now,
      inFlight: 0,
      released: false,
      timer: null,
      releaseAction,
    };
    this.states.set(serviceName, created);
    return created;
  }

  private scheduleRelease(state: ModelServiceLeaseState): void {
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }

    state.timer = setTimeout(() => {
      void this.releaseIfIdle(state.serviceName, "idle-timeout");
    }, this.idleTtlMs);
  }

  private async releaseIfIdle(serviceName: string, reason: ModelServiceReleaseReason): Promise<void> {
    const state = this.states.get(serviceName);
    if (!state) return;

    const now = this.nowFn();
    const idleMs = Math.max(0, now - state.lastUsedAt);

    if (state.inFlight > 0) {
      // 执行中禁止回收，延后重试
      this.scheduleRelease(state);
      logger.info("Model service release deferred", {
        module: "runtime/model-service-lease",
        serviceName: state.serviceName,
        lastUsedAt: state.lastUsedAt,
        idleMs,
        releaseReason: "in-flight",
        released: false,
      });
      return;
    }

    if (idleMs < this.idleTtlMs) {
      this.scheduleRelease(state);
      return;
    }

    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }

    await this.releaseState(state, reason);
  }

  private async releaseState(state: ModelServiceLeaseState, reason: ModelServiceReleaseReason): Promise<void> {
    const idleMs = Math.max(0, this.nowFn() - state.lastUsedAt);
    let released = true;
    try {
      await state.releaseAction?.();
    } catch (error) {
      released = false;
      logger.warn("Model service release callback failed", {
        module: "runtime/model-service-lease",
        serviceName: state.serviceName,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    state.released = released;

    logger.info("Model service lease evaluated", {
      module: "runtime/model-service-lease",
      serviceName: state.serviceName,
      lastUsedAt: state.lastUsedAt,
      idleMs,
      releaseReason: reason,
      released,
    });

    // 释放失败保留重试机会，避免永久卡死
    if (!released) {
      this.scheduleRelease(state);
    }
  }
}

/**
 * 构建 LM Studio / 本地 OpenAI 兼容后端的卸载动作（best-effort）
 *
 * 说明：
 * - 不同版本端点不一致，按候选顺序尝试
 * - 全部失败时不抛错，只记录日志，避免影响主链路
 */
export function createLocalModelReleaseAction(params: {
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs?: number;
}): () => Promise<void> {
  const baseUrl = params.baseUrl.replace(/\/+$/, "");
  const model = params.model.trim();
  const timeoutMs = Math.max(500, params.timeoutMs ?? 5_000);

  return async () => {
    if (!model) return;
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (params.apiKey?.trim()) {
      headers.authorization = `Bearer ${params.apiKey.trim()}`;
    }

    const requests: Array<{ url: string; method: "POST" | "DELETE"; body?: string }> = [
      {
        url: `${baseUrl}/api/v1/models/unload`,
        method: "POST",
        body: JSON.stringify({ model }),
      },
      {
        url: `${baseUrl}/api/v0/model/unload`,
        method: "POST",
        body: JSON.stringify({ model }),
      },
      {
        url: `${baseUrl}/api/v1/models/${encodeURIComponent(model)}`,
        method: "DELETE",
      },
    ];

    for (const req of requests) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const resp = await fetch(req.url, {
          method: req.method,
          headers,
          body: req.body,
          signal: controller.signal,
        });
        if (resp.ok) {
          logger.info("Model unload accepted", {
            module: "runtime/model-service-lease",
            serviceName: `agent-backend:${model}`,
            endpoint: req.url,
            status: resp.status,
          });
          return;
        }
      } catch {
        // 忽略并尝试下一个端点
      } finally {
        clearTimeout(timer);
      }
    }

    logger.info("Model unload endpoint not available, skip", {
      module: "runtime/model-service-lease",
      serviceName: `agent-backend:${model}`,
      baseUrl,
    });
  };
}

export function shouldRetryLocalModelLoad(message: string): boolean {
  const normalized = (message || "").toLowerCase();
  if (!normalized.trim()) return false;
  return [
    "model unloaded",
    "model not loaded",
    "no loaded model",
    "没有已加载的模型",
    "未加载的模型",
    "model has crashed",
    "the model has crashed",
    "channel error",
    "segmentation fault",
  ].some((pattern) => normalized.includes(pattern));
}

export function createLocalModelLoadAction(params: {
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs?: number;
}): () => Promise<boolean> {
  const baseUrl = params.baseUrl.replace(/\/+$/, "");
  const model = params.model.trim();
  const timeoutMs = Math.max(500, params.timeoutMs ?? 5_000);

  return async () => {
    if (!model) return false;
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (params.apiKey?.trim()) {
      headers.authorization = `Bearer ${params.apiKey.trim()}`;
    }

    const requests: Array<{ url: string; method: "POST"; body: string }> = [
      {
        url: `${baseUrl}/api/v1/models/load`,
        method: "POST",
        body: JSON.stringify({ model }),
      },
      {
        url: `${baseUrl}/api/v0/model/load`,
        method: "POST",
        body: JSON.stringify({ model }),
      },
    ];

    for (const req of requests) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const resp = await fetch(req.url, {
          method: req.method,
          headers,
          body: req.body,
          signal: controller.signal,
        });
        if (resp.ok) {
          logger.info("Model load accepted", {
            module: "runtime/model-service-lease",
            serviceName: `agent-backend:${model}`,
            endpoint: req.url,
            status: resp.status,
          });
          return true;
        }
      } catch {
        // 忽略并尝试下一个端点
      } finally {
        clearTimeout(timer);
      }
    }

    logger.info("Model load endpoint not available, skip", {
      module: "runtime/model-service-lease",
      serviceName: `agent-backend:${model}`,
      baseUrl,
    });
    return false;
  };
}

export async function maybeReloadLocalModelAndRetry(params: {
  module: string;
  baseUrl: string;
  model: string;
  errorMessage: string;
  attempt: number;
  apiKey?: string;
  timeoutMs?: number;
  maxRetries?: number;
  delayMs?: number;
}): Promise<boolean> {
  const maxRetries = params.maxRetries ?? LOCAL_MODEL_LOAD_MAX_RETRIES;
  if (params.attempt >= maxRetries) return false;
  if (!shouldRetryLocalModelLoad(params.errorMessage)) return false;

  const loaded = await createLocalModelLoadAction({
    baseUrl: params.baseUrl,
    model: params.model,
    apiKey: params.apiKey,
    timeoutMs: params.timeoutMs,
  })();

  logger.warn("Local model reload scheduled", {
    module: params.module,
    serviceName: `agent-backend:${params.model}`,
    attempt: params.attempt + 1,
    maxRetries,
    loaded,
    error: params.errorMessage,
  });

  await new Promise((resolve) => setTimeout(resolve, params.delayMs ?? DEFAULT_LOCAL_MODEL_RETRY_DELAY_MS));
  return true;
}

let globalModelServiceLeaseManager: ModelServiceLeaseManager | undefined;

/**
 * 获取全局单例
 */
export function getModelServiceLeaseManager(): ModelServiceLeaseManager {
  if (!globalModelServiceLeaseManager) {
    globalModelServiceLeaseManager = new ModelServiceLeaseManager();
  }
  return globalModelServiceLeaseManager;
}

/**
 * 重置全局单例（测试用）
 */
export async function resetModelServiceLeaseManager(): Promise<void> {
  if (!globalModelServiceLeaseManager) return;
  await globalModelServiceLeaseManager.stopAll("manual-stop");
  globalModelServiceLeaseManager = undefined;
}
