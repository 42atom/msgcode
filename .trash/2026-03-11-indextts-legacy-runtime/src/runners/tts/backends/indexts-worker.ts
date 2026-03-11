/**
 * msgcode: IndexTTS Worker Client (stdin/stdout JSON RPC)
 *
 * 目的：
 * - 常驻 Python 进程一次性加载 IndexTTS2
 * - Node 侧通过 JSON 行协议请求合成，显著降低冷启动成本
 *
 * 设计约束：
 * - 单 worker 串行处理（上层队列）
 * - stdout 只收 JSON 行；stderr 仅作日志
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";

type WorkerHello = { type: "hello"; kind?: string; pid?: number };
type WorkerReady = { type: "ready"; initMs?: number };
type WorkerFatal = { type: "fatal"; message: string };

type WorkerResponseOk = { id: string; ok: true; result: Record<string, unknown> };
type WorkerResponseErr = { id: string; ok: false; error: { message: string; details?: Record<string, unknown> } };
type WorkerResponse = WorkerResponseOk | WorkerResponseErr | WorkerHello | WorkerReady | WorkerFatal;

type Pending = {
  resolve: (v: Record<string, unknown>) => void;
  reject: (e: Error) => void;
  timeout: NodeJS.Timeout;
};

function isObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v && typeof v === "object" && !Array.isArray(v));
}

function safeJsonParse(line: string): WorkerResponse | null {
  try {
    const obj = JSON.parse(line) as unknown;
    if (!isObject(obj)) return null;
    return obj as WorkerResponse;
  } catch {
    return null;
  }
}

export class IndexTtsWorkerClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private ready = false;
  private starting: Promise<void> | null = null;
  private pending = new Map<string, Pending>();
  private stdoutBuffer = "";
  private queue = Promise.resolve();
  private shutdownScheduled = false;

  constructor(private params: { python: string; workerScript: string; env?: NodeJS.ProcessEnv }) {}

  getPid(): number | null {
    return this.child?.pid ?? null;
  }

  async stop(): Promise<void> {
    const child = this.child;
    this.child = null;
    this.ready = false;
    this.starting = null;
    this.shutdownScheduled = false;

    for (const [id, p] of this.pending.entries()) {
      clearTimeout(p.timeout);
      p.reject(new Error("IndexTTS worker stopped"));
      this.pending.delete(id);
    }

    if (!child) return;
    try {
      child.kill("SIGTERM");
      setTimeout(() => {
        try { child.kill("SIGKILL"); } catch { /* ignore */ }
      }, 1500).unref();
    } catch {
      // ignore
    }
  }

  async ping(timeoutMs?: number): Promise<Record<string, unknown>> {
    return await this.request("ping", {}, timeoutMs);
  }

  /**
   * Gracefully shutdown the worker after all queued synthesize() calls finish.
   *
   * - Avoids SIGKILL (better for debugging and for releasing resources)
   * - Does not interrupt in-flight synthesis
   */
  shutdownWhenIdle(): void {
    if (this.shutdownScheduled) return;
    this.shutdownScheduled = true;

    const task = this.queue.catch(() => {}).then(async () => {
      try {
        // Best-effort: ask worker to exit gracefully.
        await this.request("shutdown", {}, 3000);
      } catch {
        // Fallback: hard stop.
        await this.stop();
        return;
      }

      // Give it a short grace period to exit on its own, then hard stop.
      setTimeout(() => {
        void this.stop();
      }, 1500).unref();
    });

    this.queue = task.then(() => undefined, () => undefined);
  }

  private async ensureStarted(): Promise<void> {
    if (this.child && this.ready) return;
    if (this.starting) return await this.starting;

    this.starting = (async () => {
      this.ready = false;
      this.shutdownScheduled = false;
      const child = spawn(this.params.python, [this.params.workerScript], {
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          ...this.params.env,
          PYTHONUNBUFFERED: "1",
        },
      });
      this.child = child;

      child.stderr.on("data", (d) => {
        if (process.env.INDEX_TTS_WORKER_DEBUG === "1") {
          // eslint-disable-next-line no-console
          console.error(String(d).trimEnd());
        }
      });

      child.stdout.on("data", (d) => {
        this.stdoutBuffer += String(d);
        this.drainStdoutLines();
      });

      child.on("close", (code, signal) => {
        this.ready = false;
        this.starting = null;
        this.child = null;
        const msg = `IndexTTS worker exited (code=${code ?? "null"} signal=${signal ?? "null"})`;
        for (const [id, p] of this.pending.entries()) {
          clearTimeout(p.timeout);
          p.reject(new Error(msg));
          this.pending.delete(id);
        }
      });

      // 等 ready
      const startTimeoutMs = parseInt(process.env.INDEX_TTS_WORKER_START_TIMEOUT_MS || "180000", 10);
      const t0 = Date.now();
      while (!this.ready) {
        if (!this.child) throw new Error("IndexTTS worker crashed during startup");
        if (Date.now() - t0 > startTimeoutMs) {
          await this.stop();
          throw new Error(`IndexTTS worker start timeout (${startTimeoutMs}ms)`);
        }
        await new Promise(r => setTimeout(r, 50));
      }
    })();

    return await this.starting;
  }

  private drainStdoutLines(): void {
    // process complete lines
    while (true) {
      const idx = this.stdoutBuffer.indexOf("\n");
      if (idx < 0) break;
      const line = this.stdoutBuffer.slice(0, idx).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(idx + 1);
      if (!line) continue;
      const msg = safeJsonParse(line);
      if (!msg) {
        if (process.env.INDEX_TTS_WORKER_DEBUG === "1") {
          // eslint-disable-next-line no-console
          console.error(`[indextts-worker] non-json: ${line.slice(0, 200)}`);
        }
        continue;
      }

      if ("type" in msg && msg.type === "ready") {
        this.ready = true;
        continue;
      }
      if ("type" in msg && msg.type === "fatal") {
        this.ready = false;
        // 让启动阶段抛错：通过 stop + pending reject
        void this.stop();
        continue;
      }

      if ("id" in msg && typeof msg.id === "string" && "ok" in msg) {
        const p = this.pending.get(msg.id);
        if (!p) continue;
        clearTimeout(p.timeout);
        this.pending.delete(msg.id);
        if (msg.ok) {
          p.resolve((msg as WorkerResponseOk).result);
        } else {
          const errMsg = (msg as WorkerResponseErr).error?.message || "IndexTTS worker error";
          p.reject(new Error(errMsg));
        }
      }
    }
  }

  private async request(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<Record<string, unknown>> {
    await this.ensureStarted();

    const child = this.child;
    if (!child || !child.stdin.writable) {
      throw new Error("IndexTTS worker not running");
    }

    const id = randomUUID();
    const tmo = typeof timeoutMs === "number" && Number.isFinite(timeoutMs) ? timeoutMs : 120_000;

    const payload = {
      id,
      method,
      params: params || {},
    };

    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`IndexTTS worker request timeout (${tmo}ms): ${method}`));
        // 超时通常意味着 worker 卡死：直接重启（避免后续一直慢/无响应）
        void this.stop();
      }, tmo);

      this.pending.set(id, { resolve, reject, timeout });

      try {
        child.stdin.write(JSON.stringify(payload) + "\n");
      } catch (e) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  /**
   * 串行合成（避免同一个 worker 并发争用）
   */
  async synthesize(params: {
    text: string;
    voicePrompt: string;
    outWav: string;
    emotionVector?: number[];
    emotionAlpha?: number;
    emotionText?: string;
    intervalSilenceMs?: number;
    speed?: number;
    verbose?: boolean;
    timeoutMs?: number;
  }): Promise<{ outWav: string; durationMs?: number }> {
    // T0: TS 端开始请求
    const t0 = Date.now();

    const task = this.queue.catch(() => {}).then(async () => {
      // T1: 准备发送请求
      const t1 = Date.now();

      const result = await this.request("synthesize", {
        text: params.text,
        voicePrompt: params.voicePrompt,
        outWav: params.outWav,
        emotionVector: params.emotionVector,
        emotionAlpha: params.emotionAlpha,
        emotionText: params.emotionText,
        intervalSilenceMs: params.intervalSilenceMs,
        speed: params.speed,
        verbose: params.verbose,
      }, params.timeoutMs);

      // T3: 收到结果
      const t3 = Date.now();

      // 记录 TS 端计时到结果中
      (result as any).__tsTiming = {
        t0_start: t0,
        t1_beforeSend: t1,
        t1_t0_ms: t1 - t0,  // 队列等待时间
        t3_received: t3,
        t3_t1_ms: t3 - t1,  // worker 处理时间 (T2→T3)
        t3_t0_ms: t3 - t0,  // 端到端总时间
      };

      return result;
    });

    // 将队列推进到当前任务（无论成功失败都不阻断后续）
    this.queue = task.then(() => undefined, () => undefined);

    const r = await task;
    const outWav = String(r.outWav || params.outWav);
    const durationMs = typeof r.durationMs === "number" ? r.durationMs : undefined;

    // 打印详细计时（仅在 DEBUG 模式下）
    if (process.env.INDEX_TTS_TIMING_DEBUG === "1" && (r as any).__tsTiming) {
      const tsTiming = (r as any).__tsTiming as Record<string, number>;
      const workerTiming = (r as any).timing as Record<string, number> | undefined;
      console.error(`[TTS_TIMING] TS: queue=${tsTiming.t1_t0_ms}ms, worker=${tsTiming.t3_t1_ms}ms, total=${tsTiming.t3_t0_ms}ms`);
      if (workerTiming) {
        console.error(`[TTS_TIMING] Worker: parse=${workerTiming.p1_p0_ms}ms, infer=${workerTiming.p3_p1_ms}ms, post=${workerTiming.p4_p3_ms}ms`);
      }
    }

    return { outWav, durationMs };
  }
}
