/**
 * msgcode: P5.7-R12-T7 模型服务生命周期回归锁
 *
 * 目标：
 * 1. 空闲 10 分钟策略可配置、可观测
 * 2. in-flight 期间禁止释放
 * 3. 本地后端卸载动作采用 best-effort，不阻断主链路
 */

import { afterEach, describe, expect, it } from "bun:test";
import {
  DEFAULT_MODEL_SERVICE_IDLE_TTL_MS,
  ModelServiceLeaseManager,
  createLocalModelReleaseAction,
  resolveModelServiceIdleTtlMs,
} from "../src/runtime/model-service-lease.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.MSGCODE_MODEL_IDLE_MS;
});

describe("P5.7-R12-T7: model service idle release", () => {
  it("默认空闲阈值应为 10 分钟", () => {
    delete process.env.MSGCODE_MODEL_IDLE_MS;
    expect(resolveModelServiceIdleTtlMs()).toBe(DEFAULT_MODEL_SERVICE_IDLE_TTL_MS);
  });

  it("支持 MSGCODE_MODEL_IDLE_MS 覆盖阈值", () => {
    process.env.MSGCODE_MODEL_IDLE_MS = "12345";
    expect(resolveModelServiceIdleTtlMs()).toBe(12345);
  });

  it("空闲超过阈值后触发释放", async () => {
    const manager = new ModelServiceLeaseManager({ idleTtlMs: 40 });
    let releaseCount = 0;

    await manager.withService(
      "asr:mlx-whisper:test-model",
      async () => {
        await sleep(5);
      },
      async () => {
        releaseCount += 1;
      }
    );

    await sleep(20);
    expect(releaseCount).toBe(0);

    await sleep(35);
    expect(releaseCount).toBe(1);

    const snapshot = manager.getSnapshot("asr:mlx-whisper:test-model");
    expect(snapshot).toBeDefined();
    expect(snapshot?.released).toBe(true);
    expect((snapshot?.idleMs ?? 0) >= 40).toBe(true);

    await manager.stopAll("manual-stop");
  });

  it("in-flight 期间不应释放，完成后再释放", async () => {
    const manager = new ModelServiceLeaseManager({ idleTtlMs: 50 });
    let releaseCount = 0;
    let unblock: (() => void) | undefined;
    const block = new Promise<void>((resolve) => {
      unblock = resolve;
    });

    const running = manager.withService(
      "agent-backend:local:test-model",
      async () => {
        await block;
      },
      async () => {
        releaseCount += 1;
      }
    );

    await sleep(90);
    expect(releaseCount).toBe(0);
    expect(manager.getSnapshot("agent-backend:local:test-model")?.inFlight).toBe(1);

    unblock?.();
    await running;

    await sleep(70);
    expect(releaseCount).toBe(1);
    expect(manager.getSnapshot("agent-backend:local:test-model")?.inFlight).toBe(0);

    await manager.stopAll("manual-stop");
  });

  it("本地模型卸载动作：命中可用端点后停止继续尝试", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        method: String(init?.method || "GET"),
      });
      // 第 2 个端点成功
      if (calls.length === 2) {
        return new Response("", { status: 200 });
      }
      return new Response("", { status: 404 });
    }) as typeof fetch;

    const action = createLocalModelReleaseAction({
      baseUrl: "http://127.0.0.1:1234/",
      model: "huihui-glm-4.7-flash-abliterated-mlx",
      apiKey: "test-key",
      timeoutMs: 2000,
    });

    await action();

    expect(calls.length).toBe(2);
    expect(calls[0]?.url.endsWith("/api/v1/models/unload")).toBe(true);
    expect(calls[1]?.url.endsWith("/api/v0/model/unload")).toBe(true);
    expect(calls[0]?.method).toBe("POST");
    expect(calls[1]?.method).toBe("POST");
  });

  it("本地模型卸载动作：所有端点失败时不抛错", async () => {
    globalThis.fetch = (async () => {
      throw new Error("network failed");
    }) as typeof fetch;

    const action = createLocalModelReleaseAction({
      baseUrl: "http://127.0.0.1:1234",
      model: "huihui-glm-4.7-flash-abliterated-mlx",
      timeoutMs: 500,
    });

    let threw = false;
    try {
      await action();
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });
});
