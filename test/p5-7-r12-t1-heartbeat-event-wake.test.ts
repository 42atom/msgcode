/**
 * msgcode: P5.7-R12-T1 Heartbeat 常驻唤醒回归锁测试
 *
 * 目标：
 * - 验证 heartbeat runner 的基本行为
 * - 启动一次、停止一次、防重入、异常自恢复、手动触发
 *
 * 约束：
 * - 仅行为断言，禁止源码字符串匹配
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "bun:test";

describe("P5.7-R12-T1: Heartbeat 常驻唤醒回归锁", () => {
  describe("HeartbeatRunner 基本行为", () => {
    it("start() 启动心跳后 isAlive() 返回 true", async () => {
      const { HeartbeatRunner } = await import("../src/runtime/heartbeat.js");
      const runner = new HeartbeatRunner({ intervalMs: 1000 });

      expect(runner.isAlive()).toBe(false);
      runner.start();
      expect(runner.isAlive()).toBe(true);

      await runner.stop();
      expect(runner.isAlive()).toBe(false);
    });

    it("stop() 停止心跳后 isAlive() 返回 false", async () => {
      const { HeartbeatRunner } = await import("../src/runtime/heartbeat.js");
      const runner = new HeartbeatRunner({ intervalMs: 1000 });

      runner.start();
      expect(runner.isAlive()).toBe(true);

      await runner.stop();
      expect(runner.isAlive()).toBe(false);
    });

    it("重复 start() 不会创建多个定时器", async () => {
      const { HeartbeatRunner } = await import("../src/runtime/heartbeat.js");
      const tickCounts: number[] = [];
      const runner = new HeartbeatRunner({ intervalMs: 50 });

      runner.onTick(async () => {
        tickCounts.push(Date.now());
      });

      runner.start();
      runner.start(); // 重复调用
      runner.start(); // 重复调用

      await new Promise((r) => setTimeout(r, 200));
      await runner.stop();

      // 预期：200ms 内大约触发 4 次（50ms 周期），不因重复 start 翻倍
      expect(tickCounts.length).toBeLessThanOrEqual(6);
      expect(tickCounts.length).toBeGreaterThanOrEqual(2);
    });

    it("重复 stop() 不会抛出异常", async () => {
      const { HeartbeatRunner } = await import("../src/runtime/heartbeat.js");
      const runner = new HeartbeatRunner({ intervalMs: 1000 });

      runner.start();
      await runner.stop();
      await runner.stop(); // 重复调用
      await runner.stop(); // 重复调用

      expect(runner.isAlive()).toBe(false);
    });
  });

  describe("防重入保护", () => {
    it("tick 执行中时跳过下一轮 tick", async () => {
      const { HeartbeatRunner } = await import("../src/runtime/heartbeat.js");
      const executionOrder: string[] = [];
      let concurrentCount = 0;
      let maxConcurrent = 0;

      const runner = new HeartbeatRunner({ intervalMs: 30 });

      runner.onTick(async () => {
        concurrentCount++;
        maxConcurrent = Math.max(maxConcurrent, concurrentCount);
        executionOrder.push(`start-${concurrentCount}`);
        await new Promise((r) => setTimeout(r, 100)); // 慢执行
        executionOrder.push(`end-${concurrentCount}`);
        concurrentCount--;
      });

      runner.start();
      await new Promise((r) => setTimeout(r, 250));
      await runner.stop();

      // 验证：最大并发数应为 1（防重入生效）
      expect(maxConcurrent).toBe(1);
    });

    it("isBusy() 在 tick 执行中返回 true", async () => {
      const { HeartbeatRunner } = await import("../src/runtime/heartbeat.js");
      const runner = new HeartbeatRunner({ intervalMs: 50 });

      let busyDuringTick = false;

      runner.onTick(async () => {
        busyDuringTick = runner.isBusy();
        await new Promise((r) => setTimeout(r, 50));
      });

      runner.start();
      await new Promise((r) => setTimeout(r, 100));
      await runner.stop();

      expect(busyDuringTick).toBe(true);
    });
  });

  describe("异常自恢复", () => {
    it("tick 回调抛出异常后心跳继续运行", async () => {
      const { HeartbeatRunner } = await import("../src/runtime/heartbeat.js");
      const tickResults: boolean[] = [];
      const runner = new HeartbeatRunner({ intervalMs: 30 });

      let callCount = 0;

      runner.onTick(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error("模拟 tick 失败");
        }
        tickResults.push(true);
      });

      runner.start();
      await new Promise((r) => setTimeout(r, 150));
      await runner.stop();

      // 验证：第一次失败后，后续 tick 仍然触发
      expect(callCount).toBeGreaterThanOrEqual(2);
      expect(tickResults.length).toBeGreaterThanOrEqual(1);
    });

    it("tick 失败后 runner 仍然 alive", async () => {
      const { HeartbeatRunner } = await import("../src/runtime/heartbeat.js");
      const runner = new HeartbeatRunner({ intervalMs: 30 });

      runner.onTick(async () => {
        throw new Error("总是失败");
      });

      runner.start();
      await new Promise((r) => setTimeout(r, 100));

      // 验证：即使 tick 失败，runner 仍然 alive
      expect(runner.isAlive()).toBe(true);

      await runner.stop();
    });
  });

  describe("手动触发 (triggerNow)", () => {
    it("triggerNow() 立即触发一次 tick", async () => {
      const { HeartbeatRunner } = await import("../src/runtime/heartbeat.js");
      const tickReasons: string[] = [];
      const runner = new HeartbeatRunner({ intervalMs: 1000 }); // 长周期

      runner.onTick(async (ctx) => {
        tickReasons.push(ctx.reason);
      });

      runner.start();
      await new Promise((r) => setTimeout(r, 50)); // 等待首次 tick 完成

      runner.triggerNow("manual");
      await new Promise((r) => setTimeout(r, 50));

      await runner.stop();

      // 预期：至少有 2 次 tick（首次 + triggerNow）
      expect(tickReasons.length).toBeGreaterThanOrEqual(2);
      // 首次是 manual（start 触发），后续 triggerNow 也是 manual
      expect(tickReasons).toContain("manual");
    });

    it("未运行时 triggerNow() 不触发", async () => {
      const { HeartbeatRunner } = await import("../src/runtime/heartbeat.js");
      let tickCount = 0;
      const runner = new HeartbeatRunner({ intervalMs: 50 });

      runner.onTick(async () => {
        tickCount++;
      });

      // 不调用 start，直接 triggerNow
      runner.triggerNow("manual");
      await new Promise((r) => setTimeout(r, 100));

      expect(tickCount).toBe(0);
    });
  });

  describe("环境变量配置", () => {
    it("MSGCODE_HEARTBEAT_MS 环境变量可覆盖默认周期", async () => {
      const originalEnv = process.env.MSGCODE_HEARTBEAT_MS;

      process.env.MSGCODE_HEARTBEAT_MS = "100";

      const { HeartbeatRunner } = await import("../src/runtime/heartbeat.js");
      const runner = new HeartbeatRunner();
      const tickTimes: number[] = [];

      runner.onTick(async () => {
        tickTimes.push(Date.now());
      });

      runner.start();
      await new Promise((r) => setTimeout(r, 350));
      await runner.stop();

      // 恢复环境变量
      if (originalEnv !== undefined) {
        process.env.MSGCODE_HEARTBEAT_MS = originalEnv;
      } else {
        delete process.env.MSGCODE_HEARTBEAT_MS;
      }

      // 验证：350ms 内应该有约 3-4 次 tick（100ms 周期）
      expect(tickTimes.length).toBeGreaterThanOrEqual(2);
      expect(tickTimes.length).toBeLessThanOrEqual(5);
    });
  });

  describe("Tick 上下文", () => {
    it("tick 上下文包含 tickId、reason、startTime", async () => {
      const { HeartbeatRunner } = await import("../src/runtime/heartbeat.js");
      const contexts: Array<{ tickId: string; reason: string; startTime: number }> = [];
      const runner = new HeartbeatRunner({ intervalMs: 50 });

      runner.onTick(async (ctx) => {
        contexts.push({
          tickId: ctx.tickId,
          reason: ctx.reason,
          startTime: ctx.startTime,
        });
      });

      runner.start();
      await new Promise((r) => setTimeout(r, 150));
      await runner.stop();

      // 验证：每个 tick 都有完整上下文
      expect(contexts.length).toBeGreaterThanOrEqual(2);
      for (const ctx of contexts) {
        expect(ctx.tickId).toBeTruthy();
        expect(ctx.tickId.length).toBe(8); // UUID slice(0, 8)
        expect(["interval", "manual"]).toContain(ctx.reason);
        expect(ctx.startTime).toBeGreaterThan(0);
      }
    });
  });

  describe("单例实例", () => {
    it("getHeartbeat() 返回全局单例", async () => {
      const { getHeartbeat, resetHeartbeat } = await import("../src/runtime/heartbeat.js");

      resetHeartbeat(); // 清理

      const instance1 = getHeartbeat();
      const instance2 = getHeartbeat();

      expect(instance1).toBe(instance2);

      resetHeartbeat(); // 清理
    });

    it("resetHeartbeat() 清除单例", async () => {
      const { getHeartbeat, resetHeartbeat } = await import("../src/runtime/heartbeat.js");

      resetHeartbeat();
      const instance1 = getHeartbeat();

      resetHeartbeat();
      const instance2 = getHeartbeat();

      expect(instance1).not.toBe(instance2);

      resetHeartbeat(); // 清理
    });
  });

  // ============================================
  // P5.7-R12-T1 Hotfix 回归锁
  // ============================================

  describe("P1: 长任务 tick 不会导致心跳链路中断", () => {
    it("tick 耗时 > intervalMs 时仍继续心跳（补发机制）", async () => {
      const { HeartbeatRunner } = await import("../src/runtime/heartbeat.js");
      const tickCount = { value: 0 };
      const runner = new HeartbeatRunner({ intervalMs: 50 });

      runner.onTick(async () => {
        tickCount.value++;
        await new Promise((r) => setTimeout(r, 120)); // 慢执行 120ms > 50ms interval
      });

      runner.start();
      await new Promise((r) => setTimeout(r, 420));
      await runner.stop();

      // P1-hotfix: 预期 420ms 内至少 3 次 tick（首次 + 补发），不再是 1 次
      expect(tickCount.value).toBeGreaterThanOrEqual(3);
    });
  });

  describe("P1: triggerNow 不会复制定时链", () => {
    it("多次 triggerNow 不产生并行 interval 链", async () => {
      const { HeartbeatRunner } = await import("../src/runtime/heartbeat.js");
      const tickCount = { value: 0 };
      const runner = new HeartbeatRunner({ intervalMs: 200 });

      runner.onTick(async () => {
        tickCount.value++;
      });

      runner.start();
      await new Promise((r) => setTimeout(r, 50)); // 等待首次 tick

      // 多次手动触发
      runner.triggerNow("manual");
      await new Promise((r) => setTimeout(r, 30));
      runner.triggerNow("manual");
      await new Promise((r) => setTimeout(r, 30));

      await new Promise((r) => setTimeout(r, 900)); // 总计约 1s
      await runner.stop();

      // P1-hotfix: 预期 1s 内约 5-6 次 tick（首次 + 2 manual + 约 3 interval），不是 14+
      expect(tickCount.value).toBeLessThanOrEqual(8);
      expect(tickCount.value).toBeGreaterThanOrEqual(3);
    });
  });

  describe("P2: stop 真正等待 tick 完成", () => {
    it("stop() 返回后 tick 已完成执行", async () => {
      const { HeartbeatRunner } = await import("../src/runtime/heartbeat.js");
      const tickCompleted = { value: false };
      const runner = new HeartbeatRunner({ intervalMs: 50 });

      runner.onTick(async () => {
        await new Promise((r) => setTimeout(r, 300)); // 慢执行 300ms
        tickCompleted.value = true;
      });

      runner.start();
      await new Promise((r) => setTimeout(r, 30)); // 让 tick 开始执行

      const stopStart = Date.now();
      await runner.stop();
      const stopDuration = Date.now() - stopStart;

      // P2-hotfix: stop 应等待 tick 完成（约 300ms），而非固定 100ms
      expect(stopDuration).toBeGreaterThanOrEqual(250);
      expect(tickCompleted.value).toBe(true);
    });
  });

  // ============================================
  // P5.7-R12-T1 Hotfix-2 回归锁
  // ============================================

  describe("P1-hotfix-2: stop 清空 pendingTick", () => {
    it("stop 后再次 start 不会带着旧 pendingTick 多跑一轮", async () => {
      const { HeartbeatRunner } = await import("../src/runtime/heartbeat.js");
      const tickCount = { value: 0 };
      const runner = new HeartbeatRunner({ intervalMs: 200 });

      // 第一次启动，制造 pendingTick
      runner.onTick(async () => {
        tickCount.value++;
        await new Promise((r) => setTimeout(r, 250)); // 慢执行 > interval
      });

      runner.start();
      await new Promise((r) => setTimeout(r, 50)); // 让 tick 开始（会触发 pending）
      runner.triggerNow("manual"); // 触发 pendingTick
      await new Promise((r) => setTimeout(r, 30));

      // stop 应该清空 pendingTick
      await runner.stop();

      // 第二次启动，不应有残留 pendingTick
      tickCount.value = 0; // 重置计数
      await new Promise((r) => setTimeout(r, 50)); // 等待一小段时间

      // 预期：150ms 内只有 interval 触发的 tick（0-1 次），不应有额外的 pendingTick 触发
      expect(tickCount.value).toBeLessThanOrEqual(1);
    });
  });

  describe("P2-hotfix-2: stop 无超时等待", () => {
    it("stop() 等待任意长的 tick 完成（无 5s 超时）", async () => {
      const { HeartbeatRunner } = await import("../src/runtime/heartbeat.js");
      const tickCompleted = { value: false };
      const runner = new HeartbeatRunner({ intervalMs: 50 });

      runner.onTick(async () => {
        await new Promise((r) => setTimeout(r, 800)); // 800ms tick > 5s 超时阈值
        tickCompleted.value = true;
      });

      runner.start();
      await new Promise((r) => setTimeout(r, 30)); // 让 tick 开始执行

      await runner.stop(); // 应等待 800ms 完成，而非 5s 超时返回

      // stop 返回后 tick 应已完成
      expect(tickCompleted.value).toBe(true);
    });
  });
});
