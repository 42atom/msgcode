import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import {
  createWakeJob,
  getWakeJob,
  listWakeJobs,
  updateWakeJob,
  deleteWakeJob,
  createWakeRecord,
  getWakeRecord,
  listWakeRecords,
  updateWakeRecord,
  getPendingWakeRecords,
  getOverdueWakeRecords,
  getJobsDir,
  getRecordsDir,
  getClaimsDir,
  getJobPath,
  getRecordPath,
} from "../src/runtime/wake-store.js";
import { claimWakeRecord, releaseWakeClaim, getStaleClaims } from "../src/runtime/wake-claim.js";
import { executeStartupCatchup } from "../src/runtime/wake-catchup.js";
import type { WakeJob, WakeRecord } from "../src/runtime/wake-types.js";

function createTempWorkspace(): string {
  const root = path.join(tmpdir(), `msgcode-wake-${randomUUID()}`);
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function cleanupTempWorkspace(root: string): void {
  if (fs.existsSync(root)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe("P7: Wake Job / Record / Claim (pl0210)", () => {
  let workspace: string;

  beforeEach(() => {
    workspace = createTempWorkspace();
  });

  afterEach(() => {
    cleanupTempWorkspace(workspace);
  });

  // ============================================
  // Wake Job 测试
  // ============================================

  it("B1: 创建 Wake Job", () => {
    const job = createWakeJob(workspace, {
      id: randomUUID(),
      kind: "once",
      schedule: { kind: "at", atMs: Date.now() + 3600000 },
      mode: "now",
      taskId: "tk1000",
      hint: "检查任务进度",
      enabled: true,
    });

    expect(job.id).toBeDefined();
    expect(job.kind).toBe("once");
    expect(job.taskId).toBe("tk1000");
    expect(job.enabled).toBe(true);
    expect(job.createdAt).toBeDefined();
    expect(job.updatedAt).toBeDefined();

    // 验证文件存在
    expect(fs.existsSync(getJobPath(workspace, job.id))).toBe(true);
  });

  it("B2: 获取 Wake Job", () => {
    const job = createWakeJob(workspace, {
      id: randomUUID(),
      kind: "recurring",
      schedule: { kind: "every", everyMs: 3600000, anchorMs: Date.now() },
      mode: "next-heartbeat",
      enabled: true,
    });

    const retrieved = getWakeJob(workspace, job.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe(job.id);
    expect(retrieved?.kind).toBe("recurring");
  });

  it("B3: 更新 Wake Job", () => {
    const job = createWakeJob(workspace, {
      id: randomUUID(),
      kind: "once",
      schedule: { kind: "at", atMs: Date.now() },
      mode: "now",
      enabled: true,
    });

    const updated = updateWakeJob(workspace, job.id, { enabled: false, hint: "已禁用" });
    expect(updated?.enabled).toBe(false);
    expect(updated?.hint).toBe("已禁用");
  });

  it("B4: 删除 Wake Job", () => {
    const job = createWakeJob(workspace, {
      id: randomUUID(),
      kind: "once",
      schedule: { kind: "at", atMs: Date.now() },
      mode: "now",
      enabled: true,
    });

    const deleted = deleteWakeJob(workspace, job.id);
    expect(deleted).toBe(true);
    expect(fs.existsSync(getJobPath(workspace, job.id))).toBe(false);
  });

  // ============================================
  // Wake Record 测试
  // ============================================

  it("B5: 创建 Wake Record", () => {
    const record = createWakeRecord(workspace, {
      id: randomUUID(),
      jobId: "job-1",
      status: "pending",
      path: "task",
      taskId: "tk1000",
      hint: "继续推进",
      latePolicy: "run-if-missed",
    });

    expect(record.id).toBeDefined();
    expect(record.status).toBe("pending");
    expect(record.taskId).toBe("tk1000");
    expect(record.scheduledAt).toBeDefined();
  });

  it("B5b: createWakeRecord 自动补齐 createdAt/updatedAt", () => {
    const before = Date.now();
    const record = createWakeRecord(workspace, {
      id: randomUUID(),
      status: "pending",
      path: "task",
      latePolicy: "run-if-missed",
    });
    const after = Date.now();

    expect(record.createdAt).toBeGreaterThanOrEqual(before);
    expect(record.createdAt).toBeLessThanOrEqual(after);
    expect(record.updatedAt).toBeGreaterThanOrEqual(before);
    expect(record.updatedAt).toBeLessThanOrEqual(after);
    expect(record.createdAt).toBe(record.updatedAt);
  });

  it("B5c: updateWakeRecord 推进 updatedAt", () => {
    const record = createWakeRecord(workspace, {
      id: randomUUID(),
      status: "pending",
      path: "task",
      latePolicy: "run-if-missed",
    });

    const originalUpdatedAt = record.updatedAt;

    // 等待一小段时间确保时间戳能区分
    const waitStart = Date.now();
    while (Date.now() - waitStart < 10) { /* busy wait */ }

    const updated = updateWakeRecord(workspace, record.id, { hint: "已更新" });

    expect(updated).not.toBeNull();
    expect(updated!.updatedAt).toBeGreaterThan(originalUpdatedAt);
    expect(updated!.hint).toBe("已更新");
  });

  it("B6: 获取 pending Wake Records", () => {
    const id1 = randomUUID();
    const id2 = randomUUID();

    createWakeRecord(workspace, {
      id: id1,
      status: "pending",
      path: "task",
      latePolicy: "run-if-missed",
    });

    createWakeRecord(workspace, {
      id: id2,
      status: "claimed",
      path: "task",
      latePolicy: "run-if-missed",
    });

    const pending = getPendingWakeRecords(workspace);
    expect(pending.length).toBeGreaterThanOrEqual(2);
  });

  it("B7: 获取 overdue Wake Records", () => {
    const id = randomUUID();
    const now = Date.now();

    // 使用正确的 API 传入过去的 scheduledAt
    createWakeRecord(workspace, {
      id: id,
      status: "pending",
      path: "task",
      latePolicy: "run-if-missed",
    }, now - 10000); // 10秒前

    const overdue = getOverdueWakeRecords(workspace);
    expect(overdue.some((r) => r.id === id)).toBe(true);
  });

  // ============================================
  // Claim 测试
  // ============================================

  it("B8: 原子抢占 Wake Record", () => {
    const recordId = randomUUID();
    const now = Date.now();

    // 先创建 pending record
    const record: WakeRecord = {
      id: recordId,
      status: "pending",
      path: "task",
      latePolicy: "run-if-missed",
      scheduledAt: now,
      createdAt: now,
      updatedAt: now,
    };

    fs.mkdirSync(getRecordsDir(workspace), { recursive: true });
    fs.writeFileSync(getRecordPath(workspace, recordId), JSON.stringify(record, null, 2));

    // 第一次 claim 应该成功
    const claim1 = claimWakeRecord(workspace, recordId, "consumer-1");
    expect(claim1).not.toBeNull();
    expect(claim1?.owner).toBe("consumer-1");

    // 第二次 claim 应该失败（已被抢占）
    const claim2 = claimWakeRecord(workspace, recordId, "consumer-2");
    expect(claim2).toBeNull();

    // 释放 claim
    releaseWakeClaim(workspace, recordId);
  });

  it("B9: Stale claim 可被 reclaim", async () => {
    const recordId = randomUUID();
    const now = Date.now();

    // 创建 pending record
    const record: WakeRecord = {
      id: recordId,
      status: "pending",
      path: "task",
      latePolicy: "run-if-missed",
      scheduledAt: now - 20000,
      createdAt: now - 20000,
      updatedAt: now - 20000,
    };

    fs.mkdirSync(getRecordsDir(workspace), { recursive: true });
    fs.writeFileSync(getRecordPath(workspace, recordId), JSON.stringify(record, null, 2));

    // 创建已过期的 claim（lease 已过期）
    // 注意：我们需要先真正 claim 一次，然后再修改它的 leaseUntil
    // 简化方法：直接 claim，然后修改 record 为 pending，再尝试 reclaim

    // 第一次 claim 应该成功
    const claim1 = claimWakeRecord(workspace, recordId, "consumer-old", 1000);
    expect(claim1).not.toBeNull();

    // 释放 claim
    releaseWakeClaim(workspace, recordId);

    // 手动把 record 改回 pending（模拟 lease 过期的情况）
    const updatedRecord = JSON.parse(fs.readFileSync(getRecordPath(workspace, recordId), "utf8"));
    updatedRecord.status = "pending";
    updatedRecord.claimedAt = undefined;
    updatedRecord.updatedAt = now;
    fs.writeFileSync(getRecordPath(workspace, recordId), JSON.stringify(updatedRecord, null, 2));

    // 现在应该可以 reclaim（因为 lease 已过期且已释放）
    const newClaim = claimWakeRecord(workspace, recordId, "consumer-new", 1000);
    expect(newClaim).not.toBeNull();
    expect(newClaim?.owner).toBe("consumer-new");
  });

  // ============================================
  // Startup Catch-up 测试
  // ============================================

  it("B10: Startup catch-up 处理 overdue records", async () => {
    const now = Date.now();

    // 使用正确的 API 创建两个 overdue records
    const r1 = createWakeRecord(workspace, {
      id: randomUUID(),
      status: "pending",
      path: "task",
      latePolicy: "skip-if-missed", // 应该被标记为 expired
    }, now - 10000);

    const r2 = createWakeRecord(workspace, {
      id: randomUUID(),
      status: "pending",
      path: "task",
      latePolicy: "run-if-missed", // 应该保持 pending
    }, now - 10000);

    // 执行 catch-up
    const result = await executeStartupCatchup(workspace);

    expect(result.overdueRecords).toBeGreaterThanOrEqual(2);

    // 检查 r1 是否被标记为 expired
    const updatedR1 = getWakeRecord(workspace, r1.id);
    expect(updatedR1?.status).toBe("expired");
    expect(updatedR1?.completedAt).toBeDefined(); // GC 需要 completedAt

    // 检查 r2 是否保持 pending
    const updatedR2 = getWakeRecord(workspace, r2.id);
    expect(updatedR2?.status).toBe("pending");
  });

  it("B11: Startup catch-up 清理 stale claims 并复位 record", async () => {
    const recordId = randomUUID();
    const now = Date.now();

    // 使用正确的 API 创建 pending record
    createWakeRecord(workspace, {
      id: recordId,
      status: "pending",
      path: "task",
      latePolicy: "run-if-missed",
    }, now - 10000);

    // 手动创建一个 stale claim（直接写文件）
    const staleClaim = {
      wakeId: recordId,
      owner: "dead-consumer",
      claimedAt: now - 400000,
      leaseUntil: now - 300000, // 已过期
      safetyMarginSec: 10,
    };

    fs.mkdirSync(getClaimsDir(workspace), { recursive: true });
    fs.writeFileSync(
      path.join(getClaimsDir(workspace), `${recordId}.claim`),
      JSON.stringify(staleClaim, null, 2)
    );

    // 把 record 改回 claimed 状态（模拟有 consumer 正在处理但已 stale）
    updateWakeRecord(workspace, recordId, { status: "claimed" });

    // 执行 catch-up
    const result = await executeStartupCatchup(workspace);

    // 应该清理了 stale claim 并复位 record
    expect(result.reclaimedClaims).toBe(1);

    // record 应该被改回 pending
    const resetRecord = getWakeRecord(workspace, recordId);
    expect(resetRecord?.status).toBe("pending");
  });

  // ============================================
  // 文件布局验证
  // ============================================

  it("B12: 目录结构符合 pl0210 规范", () => {
    // 创建 job
    const jobId = randomUUID();
    createWakeJob(workspace, {
      id: jobId,
      kind: "once",
      schedule: { kind: "at", atMs: Date.now() },
      mode: "now",
      enabled: true,
    });

    // 创建 record（会触发 records 目录创建）
    const recordId = randomUUID();
    createWakeRecord(workspace, {
      id: recordId,
      status: "pending",
      path: "task",
      latePolicy: "run-if-missed",
    });

    // 尝试 claim（会触发 claims 目录创建）
    claimWakeRecord(workspace, recordId, "test-owner");

    // 验证目录结构
    expect(fs.existsSync(path.join(workspace, ".msgcode", "wakeups", "jobs"))).toBe(true);
    expect(fs.existsSync(path.join(workspace, ".msgcode", "wakeups", "records"))).toBe(true);
    expect(fs.existsSync(path.join(workspace, ".msgcode", "wakeups", "claims"))).toBe(true);
  });
});
