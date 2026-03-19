import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import {
  getDefaultWakeDir,
  getWakeJobsDir,
  getWakeRecordsDir,
  getWakeClaimsDir,
  isWakeJob,
  isWakeRecord,
} from "../src/runtime/wake-types.js";
import {
  createWakeJob,
  createWakeRecord,
  getJobPath,
  getRecordPath,
  getWakeJob,
  getWakeRecord,
  listWakeJobs,
  listWakeRecords,
} from "../src/runtime/wake-store.js";

function createTempWorkspace(): string {
  const root = path.join(tmpdir(), `msgcode-wake-contract-${randomUUID()}`);
  fs.mkdirSync(root, { recursive: true });
  return root;
}

describe("tk0237: wake job and record file contract", () => {
  let workspace: string;

  beforeEach(() => {
    workspace = createTempWorkspace();
  });

  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it("路径真相应固定在 .msgcode/wakeups/jobs|records|claims", () => {
    expect(getDefaultWakeDir(workspace)).toBe(path.join(workspace, ".msgcode", "wakeups"));
    expect(getWakeJobsDir(workspace)).toBe(path.join(workspace, ".msgcode", "wakeups", "jobs"));
    expect(getWakeRecordsDir(workspace)).toBe(path.join(workspace, ".msgcode", "wakeups", "records"));
    expect(getWakeClaimsDir(workspace)).toBe(path.join(workspace, ".msgcode", "wakeups", "claims"));
  });

  it("wake job 落盘后应满足正式文件合同", () => {
    const job = createWakeJob(workspace, {
      id: "job-test-1",
      kind: "recurring",
      schedule: { kind: "every", everyMs: 60000, anchorMs: 1700000000000 },
      mode: "next-heartbeat",
      taskId: "tk9999",
      enabled: true,
      hint: "daily summary",
      latePolicy: "run-if-missed",
    });

    const raw = JSON.parse(fs.readFileSync(getJobPath(workspace, job.id), "utf8"));
    expect(isWakeJob(raw)).toBe(true);

    const persisted = getWakeJob(workspace, job.id);
    expect(persisted).not.toBeNull();
    expect(persisted!.mode).toBe("next-heartbeat");
    expect(persisted!.schedule.kind).toBe("every");
    expect(persisted!.taskId).toBe("tk9999");
    expect(persisted!.enabled).toBe(true);
  });

  it("wake record 落盘后应满足正式文件合同", () => {
    const record = createWakeRecord(
      workspace,
      {
        id: "record-test-1",
        jobId: "job-test-1",
        status: "pending",
        path: "task",
        taskId: "tk9999",
        hint: "resume task",
        latePolicy: "run-if-missed",
      },
      1700000000000,
    );

    const raw = JSON.parse(fs.readFileSync(getRecordPath(workspace, record.id), "utf8"));
    expect(isWakeRecord(raw)).toBe(true);

    const persisted = getWakeRecord(workspace, record.id);
    expect(persisted).not.toBeNull();
    expect(persisted!.status).toBe("pending");
    expect(persisted!.path).toBe("task");
    expect(persisted!.latePolicy).toBe("run-if-missed");
    expect(persisted!.scheduledAt).toBe(1700000000000);
  });

  it("非法 wake job / record JSON 不应混入主链读取结果", () => {
    fs.mkdirSync(getWakeJobsDir(workspace), { recursive: true });
    fs.mkdirSync(getWakeRecordsDir(workspace), { recursive: true });

    fs.writeFileSync(
      path.join(getWakeJobsDir(workspace), "bad-job.json"),
      JSON.stringify({
        id: "bad-job",
        kind: "recurring",
        schedule: { kind: "every", everyMs: 60000, anchorMs: 1700000000000 },
        mode: "later",
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }, null, 2),
      "utf8",
    );

    fs.writeFileSync(
      path.join(getWakeRecordsDir(workspace), "bad-record.json"),
      JSON.stringify({
        id: "bad-record",
        status: "waiting",
        path: "task",
        latePolicy: "run-if-missed",
        scheduledAt: Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }, null, 2),
      "utf8",
    );

    expect(getWakeJob(workspace, "bad-job")).toBeNull();
    expect(getWakeRecord(workspace, "bad-record")).toBeNull();
    expect(listWakeJobs(workspace)).toEqual([]);
    expect(listWakeRecords(workspace)).toEqual([]);
  });
});
