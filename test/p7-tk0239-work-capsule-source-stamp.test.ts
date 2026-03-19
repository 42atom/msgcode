import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { createWakeRecord, getWakeRecord, updateWakeRecord } from "../src/runtime/wake-store.js";
import { assembleWakeCapsule } from "../src/runtime/wake-consume.js";
import { createTaskRecord, type TaskRecord } from "../src/runtime/task-types.js";
import { writeDispatchRecord } from "../src/runtime/work-continuity.js";

function createTempWorkspace(): string {
  const root = path.join(tmpdir(), `msgcode-wake-capsule-${randomUUID()}`);
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function writeTaskDoc(workspace: string, fileName: string, content = "# task\n"): string {
  const issuesDir = path.join(workspace, "issues");
  fs.mkdirSync(issuesDir, { recursive: true });
  const filePath = path.join(issuesDir, fileName);
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}

function buildRuntimeTask(workspace: string, taskId: string, checkpointUpdatedAt: number): TaskRecord {
  const base = createTaskRecord({
    chatId: "chat-wake-capsule",
    workspacePath: workspace,
    goal: "推进 wake 主线",
  });
  return {
    ...base,
    taskId,
    status: "running",
    checkpoint: {
      currentPhase: "running",
      summary: "任务进行中",
      nextAction: "继续推进主线",
      updatedAt: checkpointUpdatedAt,
    },
  };
}

describe("tk0239: work capsule builder and source stamp", () => {
  let workspace: string;

  beforeEach(() => {
    workspace = createTempWorkspace();
  });

  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it("task wake 应组装最小 work capsule 字段", async () => {
    const taskId = "tk4300";
    writeTaskDoc(workspace, "tk4300.doi.runtime.parent-task.md");

    const record = createWakeRecord(workspace, {
      id: randomUUID(),
      status: "pending",
      path: "task",
      taskId,
      hint: "继续推进",
      latePolicy: "run-if-missed",
    });

    const capsule = await assembleWakeCapsule({
      workspacePath: workspace,
      wakeRecord: record,
      runtimeTask: buildRuntimeTask(workspace, taskId, Date.now()),
    });

    expect(capsule).not.toBeNull();
    expect(capsule?.taskId).toBe(taskId);
    expect(capsule?.phase).toBe("running");
    expect(capsule?.checkpoint.summary).toBe("任务进行中");
    expect(capsule?.checkpoint.nextAction).toBe("继续推进主线");
    expect(capsule?.activeDispatch.subtaskIds).toEqual([]);
    expect(capsule?.sourceStamp.taskCheckpointUpdatedAt).toBeDefined();
    expect(capsule?.sourceStamp.wakeRecordUpdatedAt).toBe(record.updatedAt);
  });

  it("底层 wake/task/dispatch/checkpoint 变化后 sourceStamp 应重建", async () => {
    const taskId = "tk4301";
    const parentPath = writeTaskDoc(workspace, "tk4301.tdo.runtime.parent-task.md");
    writeTaskDoc(workspace, "tk4302.tdo.runtime.child-task.md");

    const record = createWakeRecord(workspace, {
      id: randomUUID(),
      status: "pending",
      path: "task",
      taskId,
      hint: "初次唤醒",
      latePolicy: "run-if-missed",
    });

    const checkpointAt1 = Date.now();
    const capsule1 = await assembleWakeCapsule({
      workspacePath: workspace,
      wakeRecord: record,
      runtimeTask: buildRuntimeTask(workspace, taskId, checkpointAt1),
    });

    await new Promise((resolve) => setTimeout(resolve, 5));

    await writeDispatchRecord({
      workspacePath: workspace,
      parentTaskId: taskId,
      childTaskId: "tk4302",
      client: "codex",
      persona: "执行同学",
      goal: "补 source stamp 回归",
      cwd: workspace,
      acceptance: ["source stamp 更新"],
    });

    fs.renameSync(
      parentPath,
      path.join(workspace, "issues", "tk4301.doi.runtime.parent-task.md"),
    );

    updateWakeRecord(workspace, record.id, {
      hint: "二次唤醒",
    });
    const updatedRecord = getWakeRecord(workspace, record.id);

    const checkpointAt2 = checkpointAt1 + 1000;
    const capsule2 = await assembleWakeCapsule({
      workspacePath: workspace,
      wakeRecord: updatedRecord!,
      runtimeTask: buildRuntimeTask(workspace, taskId, checkpointAt2),
    });

    expect(capsule1).not.toBeNull();
    expect(capsule2).not.toBeNull();
    expect(capsule2?.sourceStamp.wakeRecordUpdatedAt).toBeGreaterThan(
      capsule1!.sourceStamp.wakeRecordUpdatedAt,
    );
    expect(capsule2?.sourceStamp.taskCheckpointUpdatedAt).toBe(checkpointAt2);
    expect(capsule2?.sourceStamp.dispatchUpdatedAt.length).toBeGreaterThan(
      capsule1!.sourceStamp.dispatchUpdatedAt.length,
    );
    expect(capsule1?.sourceStamp.issueStateNames).toContain("tk4301.tdo.runtime.parent-task.md");
    expect(capsule2?.sourceStamp.issueStateNames).toContain("tk4301.doi.runtime.parent-task.md");
  });
});
