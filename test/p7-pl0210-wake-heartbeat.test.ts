import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import {
  createWakeRecord,
  getWakeRecord,
  getPendingWakeRecords,
} from "../src/runtime/wake-store.js";
import { claimWakeRecord, releaseWakeClaim } from "../src/runtime/wake-claim.js";
import {
  consumePendingWakes,
  hasPendingWakes,
} from "../src/runtime/wake-heartbeat.js";

function createTempWorkspace(): string {
  const root = path.join(tmpdir(), `msgcode-wake-heartbeat-${randomUUID()}`);
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function cleanupTempWorkspace(root: string): void {
  if (fs.existsSync(root)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe("P7-3: Wake Heartbeat Integration (pl0210 第三刀)", () => {
  let workspace: string;

  beforeEach(() => {
    workspace = createTempWorkspace();
  });

  afterEach(() => {
    cleanupTempWorkspace(workspace);
  });

  it("D1: 无 pending wakes 时返回空数组", async () => {
    const results = await consumePendingWakes(
      workspace,
      async () => {
        // 不应该调用
        throw new Error("不应该调用消费者");
      }
    );

    expect(results).toEqual([]);
  });

  it("D2: 单个 pending wake 被消费", async () => {
    const record = createWakeRecord(workspace, {
      id: randomUUID(),
      status: "pending",
      path: "task",
      taskId: "tk-test",
      hint: "测试消费",
      latePolicy: "run-if-missed",
    });

    let consumerCalled = false;
    let capturedHint: string | null = null;

    const results = await consumePendingWakes(
      workspace,
      async ({ wakeRecord, capsule, hint }) => {
        consumerCalled = true;
        capturedHint = hint;
        expect(wakeRecord.id).toBe(record.id);
      }
    );

    expect(results.length).toBe(1);
    expect(results[0].consumed).toBe(true);
    expect(results[0].wakeRecordId).toBe(record.id);
    expect(consumerCalled).toBe(true);
    expect(capturedHint).toBe("测试消费");
  });

  it("D3: 多个 pending wakes 只消费已到点的，按 scheduledAt 顺序", async () => {
    const now = Date.now();

    // r1: 未来10秒 - 不应被消费
    const r1 = createWakeRecord(workspace, {
      id: randomUUID(),
      status: "pending",
      path: "task",
      latePolicy: "run-if-missed",
    }, now + 10000);

    // r2: 现在 - 应该被消费
    const r2 = createWakeRecord(workspace, {
      id: randomUUID(),
      status: "pending",
      path: "task",
      latePolicy: "run-if-missed",
    }, now);

    // r3: 未来20秒 - 不应被消费
    const r3 = createWakeRecord(workspace, {
      id: randomUUID(),
      status: "pending",
      path: "task",
      latePolicy: "run-if-missed",
    }, now + 20000);

    const consumedIds: string[] = [];

    await consumePendingWakes(
      workspace,
      async ({ wakeRecord }) => {
        consumedIds.push(wakeRecord.id);
      },
      { maxConsumePerTick: 3 }
    );

    // 应该只消费已到点的：r2
    // r1 和 r3 是未来的，不应被消费
    expect(consumedIds).toEqual([r2.id]);
  });

  it("D4: 已 claimed 的 wake 不会被消费", async () => {
    const record = createWakeRecord(workspace, {
      id: randomUUID(),
      status: "pending",
      path: "task",
      latePolicy: "run-if-missed",
    });

    // 先被别的消费者 claim
    const otherClaim = claimWakeRecord(workspace, record.id, "other-consumer");
    expect(otherClaim).not.toBeNull();

    const results = await consumePendingWakes(
      workspace,
      async () => {}
    );

    // claimed 记录被正确跳过（不返回结果，因为只处理 pending）
    // pendingRecords 返回 claimed 记录，但 actionableRecords 过滤掉了它们
    expect(results.length).toBe(0);
  });

  it("D5: hasPendingWakes 正确检测", () => {
    expect(hasPendingWakes(workspace)).toBe(false);

    createWakeRecord(workspace, {
      id: randomUUID(),
      status: "pending",
      path: "task",
      latePolicy: "run-if-missed",
    });

    expect(hasPendingWakes(workspace)).toBe(true);
  });

  it("D6: maxConsumePerTick 限制消费数量", async () => {
    // 创建 5 个 pending records
    for (let i = 0; i < 5; i++) {
      createWakeRecord(workspace, {
        id: randomUUID(),
        status: "pending",
        path: "task",
        latePolicy: "run-if-missed",
      });
    }

    let consumeCount = 0;
    await consumePendingWakes(
      workspace,
      async () => {
        consumeCount++;
      },
      { maxConsumePerTick: 2 }
    );

    // 应该只消费 2 个
    expect(consumeCount).toBe(2);
  });

  it("D7: 消费者抛出异常时 claim 被释放", async () => {
    const record = createWakeRecord(workspace, {
      id: randomUUID(),
      status: "pending",
      path: "task",
      latePolicy: "run-if-missed",
    });

    const results = await consumePendingWakes(
      workspace,
      async () => {
        throw new Error("消费者模拟失败");
      }
    );

    expect(results[0].consumed).toBe(false);
    expect(results[0].error).toBe("消费者模拟失败");

    // claim 应该被释放，可以再次被 claim
    const newClaim = claimWakeRecord(workspace, record.id, "new-consumer");
    expect(newClaim).not.toBeNull();
  });
});
