import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { createWakeRecord, gcTerminalWakeRecords, getClaimsDir, getRecordPath, getWakeRecord, updateWakeRecord } from "../src/runtime/wake-store.js";
import { executeStartupCatchup } from "../src/runtime/wake-catchup.js";
import { getWakeIncidentsDir } from "../src/runtime/wake-incident.js";
import { consumePendingWakes } from "../src/runtime/wake-heartbeat.js";

function createTempWorkspace(): string {
  const root = path.join(tmpdir(), `msgcode-wake-claim-retention-${randomUUID()}`);
  fs.mkdirSync(root, { recursive: true });
  return root;
}

describe("tk0238: wake claim catchup retention", () => {
  let workspace: string;

  beforeEach(() => {
    workspace = createTempWorkspace();
  });

  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it("stale reclaim 应推进失败记忆字段", async () => {
    const record = createWakeRecord(workspace, {
      id: randomUUID(),
      status: "pending",
      path: "task",
      latePolicy: "run-if-missed",
    }, Date.now() - 10000);

    fs.mkdirSync(getClaimsDir(workspace), { recursive: true });
    fs.writeFileSync(
      path.join(getClaimsDir(workspace), `${record.id}.claim`),
      JSON.stringify({
        wakeId: record.id,
        owner: "dead-consumer",
        claimedAt: Date.now() - 400000,
        leaseUntil: Date.now() - 300000,
        safetyMarginSec: 10,
      }, null, 2),
      "utf8",
    );
    updateWakeRecord(workspace, record.id, { status: "claimed" });

    const result = await executeStartupCatchup(workspace);
    expect(result.reclaimedClaims).toBe(1);

    const updated = getWakeRecord(workspace, record.id);
    expect(updated?.status).toBe("pending");
    expect(updated?.reclaimCount).toBe(1);
    expect(updated?.lastFailureCode).toBe("WAKE_STALE_RECLAIM");
    expect(updated?.lastFailureAt).toBeDefined();
    expect(updated?.lastFailureSummary).toContain("stale claim reclaimed");
  });

  it("连续 stale reclaim 超阈值时应升级 failed 并落 incident", async () => {
    const record = createWakeRecord(workspace, {
      id: randomUUID(),
      status: "pending",
      path: "task",
      latePolicy: "run-if-missed",
      reclaimCount: 2,
    }, Date.now() - 10000);

    fs.mkdirSync(getClaimsDir(workspace), { recursive: true });
    fs.writeFileSync(
      path.join(getClaimsDir(workspace), `${record.id}.claim`),
      JSON.stringify({
        wakeId: record.id,
        owner: "dead-consumer",
        claimedAt: Date.now() - 400000,
        leaseUntil: Date.now() - 300000,
        safetyMarginSec: 10,
      }, null, 2),
      "utf8",
    );
    updateWakeRecord(workspace, record.id, { status: "claimed", reclaimCount: 2 });

    await executeStartupCatchup(workspace);

    const updated = getWakeRecord(workspace, record.id);
    expect(updated?.status).toBe("failed");
    expect(updated?.failedAt).toBeDefined();
    expect(updated?.reclaimCount).toBe(3);

    const incidentsDir = getWakeIncidentsDir(workspace);
    const incidentFiles = fs.existsSync(incidentsDir) ? fs.readdirSync(incidentsDir) : [];
    expect(incidentFiles.some((file) => file.includes(record.id))).toBe(true);
  });

  it("消费者连续失败超阈值时不应静默重试", async () => {
    const record = createWakeRecord(workspace, {
      id: randomUUID(),
      status: "pending",
      path: "task",
      latePolicy: "run-if-missed",
      reclaimCount: 2,
    }, Date.now() - 10000);

    const results = await consumePendingWakes(
      workspace,
      async () => {
        throw new Error("consumer boom");
      },
    );

    expect(results[0]?.consumed).toBe(false);

    const updated = getWakeRecord(workspace, record.id);
    expect(updated?.status).toBe("pending");
    expect(updated?.lastFailureCode).toBe("WAKE_CONSUME_FAILED");
    expect(updated?.lastFailureSummary).toContain("consumer boom");
  });

  it("终态 retention 应区分 7d 与 30d", () => {
    const now = Date.now();

    createWakeRecord(workspace, {
      id: "done-old",
      status: "done",
      path: "task",
      latePolicy: "run-if-missed",
      completedAt: now - (8 * 24 * 60 * 60 * 1000),
    }, now - (9 * 24 * 60 * 60 * 1000));

    createWakeRecord(workspace, {
      id: "failed-recent",
      status: "failed",
      path: "task",
      latePolicy: "run-if-missed",
      failedAt: now - (8 * 24 * 60 * 60 * 1000),
    }, now - (9 * 24 * 60 * 60 * 1000));

    createWakeRecord(workspace, {
      id: "failed-old",
      status: "failed",
      path: "task",
      latePolicy: "run-if-missed",
      failedAt: now - (31 * 24 * 60 * 60 * 1000),
    }, now - (32 * 24 * 60 * 60 * 1000));

    const deleted = gcTerminalWakeRecords(workspace);
    expect(deleted).toBe(2);
    expect(fs.existsSync(getRecordPath(workspace, "done-old"))).toBe(false);
    expect(fs.existsSync(getRecordPath(workspace, "failed-old"))).toBe(false);
    expect(fs.existsSync(getRecordPath(workspace, "failed-recent"))).toBe(true);
  });
});
