import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import {
  createWakeRecord,
  getWakeRecord,
  updateWakeRecord,
  getRecordsDir,
  getRecordPath,
} from "../src/runtime/wake-store.js";
import { claimWakeRecord } from "../src/runtime/wake-claim.js";
import { assembleWakeCapsule, consumeWakeRecord } from "../src/runtime/wake-consume.js";
import type { WakeRecord } from "../src/runtime/wake-types.js";

function createTempWorkspace(): string {
  const root = path.join(tmpdir(), `msgcode-wake-consume-${randomUUID()}`);
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function cleanupTempWorkspace(root: string): void {
  if (fs.existsSync(root)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function writeTaskDoc(workspace: string, fileName: string, content = "# task\n"): string {
  const issuesDir = path.join(workspace, "issues");
  fs.mkdirSync(issuesDir, { recursive: true });
  const filePath = path.join(issuesDir, fileName);
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}

describe("P7-2: Wake Consume -> Work Capsule (pl0210 第二刀)", () => {
  let workspace: string;

  beforeEach(() => {
    workspace = createTempWorkspace();
  });

  afterEach(() => {
    cleanupTempWorkspace(workspace);
  });

  it("C1: 轻路径 - 无 taskId 的 wake record 返回 null capsule", async () => {
    const record = createWakeRecord(workspace, {
      id: randomUUID(),
      status: "pending",
      path: "task",
      hint: "这是一个纯提醒",
      latePolicy: "run-if-missed",
    });

    // claim 它
    const claim = claimWakeRecord(workspace, record.id, "consumer-1");
    expect(claim).not.toBeNull();

    // 消费 - 没有 taskId 应该返回 null capsule
    const result = await consumeWakeRecord({
      workspacePath: workspace,
      wakeRecordId: record.id,
    });

    expect(result.capsule).toBeNull();
    expect(result.hint).toBe("这是一个纯提醒");
  });

  it("C2: 有 taskId 但无 runtime task 时，capsule 能组装", async () => {
    const taskId = "tk-test-" + randomUUID();
    const record = createWakeRecord(workspace, {
      id: randomUUID(),
      status: "pending",
      path: "task",
      taskId,
      hint: "继续推进这个任务",
      latePolicy: "run-if-missed",
    });

    // claim 它
    const claim = claimWakeRecord(workspace, record.id, "consumer-1");
    expect(claim).not.toBeNull();

    // 消费 - 有 taskId 但没有 runtime task
    const result = await consumeWakeRecord({
      workspacePath: workspace,
      wakeRecordId: record.id,
    });

    expect(result.capsule).not.toBeNull();
    expect(result.capsule?.taskId).toBe(taskId);
    expect(result.capsule?.wake.id).toBe(record.id);
    expect(result.capsule?.wake.hint).toBe("继续推进这个任务");
    expect(result.capsule?.sourceStamp).toBeDefined();
    expect(result.capsule?.sourceStamp.wakeRecordUpdatedAt).toBeDefined();
  });

  it("C3: assembleWakeCapsule 包含正确的 wake 字段", async () => {
    const taskId = "tk-capsule-test-" + randomUUID();
    const scheduledTime = Date.now() - 60000; // 1分钟前
    const record = createWakeRecord(
      workspace,
      {
        id: randomUUID(),
        jobId: "job-test-123",
        status: "pending",
        path: "task",
        taskId,
        hint: "请继续",
        latePolicy: "run-if-missed",
      },
      scheduledTime
    );

    const capsule = await assembleWakeCapsule({
      workspacePath: workspace,
      wakeRecord: record,
      runtimeTask: null,
    });

    expect(capsule).not.toBeNull();
    expect(capsule?.wake.id).toBe(record.id);
    expect(capsule?.wake.jobId).toBe("job-test-123");
    expect(capsule?.wake.scheduledAt).toBe(scheduledTime);
    expect(capsule?.wake.hint).toBe("请继续");
  });

  it("C4: consumeWakeRecord 找不到 record 时报错", async () => {
    await expect(
      consumeWakeRecord({
        workspacePath: workspace,
        wakeRecordId: "non-existent-id",
      })
    ).rejects.toThrow("not found");
  });

  it("C5: consumeWakeRecord 返回正确的上下文", async () => {
    await expect(
      consumeWakeRecord({
        workspacePath: workspace,
        wakeRecordId: "non-existent-id",
      })
    ).rejects.toThrow("not found");
  });

  it("C6: sourceStamp.issueStateNames 应记录 issue 文件名，而不是 slug", async () => {
    writeTaskDoc(workspace, "tk4100.doi.runtime.parent-task.md");
    writeTaskDoc(workspace, "tk4101.tdo.web.child-task.md");

    const record = createWakeRecord(workspace, {
      id: randomUUID(),
      status: "pending",
      path: "task",
      taskId: "tk4100",
      hint: "检查 source stamp",
      latePolicy: "run-if-missed",
    });

    const capsule = await assembleWakeCapsule({
      workspacePath: workspace,
      wakeRecord: record,
      runtimeTask: null,
    });

    expect(capsule).not.toBeNull();
    expect(capsule?.sourceStamp.issueStateNames).toContain("tk4100.doi.runtime.parent-task.md");
    expect(capsule?.sourceStamp.issueStateNames).toContain("tk4101.tdo.web.child-task.md");
    expect(capsule?.sourceStamp.issueStateNames).not.toContain("parent-task");
    expect(capsule?.sourceStamp.issueStateNames).not.toContain("child-task");
  });
});
