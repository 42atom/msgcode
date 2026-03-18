import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { TaskStore } from "../src/runtime/task-store.js";
import { createTaskRecord } from "../src/runtime/task-types.js";
import type { SubagentTaskRecord } from "../src/runtime/subagent.js";
import {
  acquireWorkWriterLock,
  buildWorkRecoverySnapshot,
  classifyRequestPath,
  writeDispatchRecord,
} from "../src/runtime/work-continuity.js";

function createTempWorkspace(): string {
  const root = path.join(tmpdir(), `msgcode-work-${randomUUID()}`);
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.join(root, "issues"), { recursive: true });
  fs.mkdirSync(path.join(root, ".msgcode", "dispatch"), { recursive: true });
  fs.mkdirSync(path.join(root, ".msgcode", "subagents"), { recursive: true });
  return root;
}

function cleanupTempWorkspace(root: string): void {
  if (fs.existsSync(root)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function writeTaskDoc(workspace: string, filename: string, content = "# task\n"): string {
  const filePath = path.join(workspace, "issues", filename);
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}

function writeSubagentRecord(workspace: string, record: SubagentTaskRecord): void {
  fs.writeFileSync(record.taskFile, JSON.stringify(record, null, 2), "utf8");
}

describe("P6: Work Continuity Foundation (tk0205)", () => {
  let workspace: string;

  beforeEach(() => {
    workspace = createTempWorkspace();
  });

  afterEach(() => {
    cleanupTempWorkspace(workspace);
  });

  it("A1/A4/A5: work capsule 可由文件真相源重建", async () => {
    writeTaskDoc(workspace, "tk1000.doi.runtime.parent-task.md");
    writeTaskDoc(workspace, "tk1001.bkd.runtime.child-task.md");

    const subagentTaskId = randomUUID();
    const subagentTaskFile = path.join(workspace, ".msgcode", "subagents", `${subagentTaskId}.json`);
    const subagentRecord: SubagentTaskRecord = {
      taskId: subagentTaskId,
      client: "codex",
      workspacePath: workspace,
      groupName: "subagent-codex-work",
      sessionName: "session-1",
      goal: "child task",
      status: "running",
      doneMarker: "DONE",
      failedMarker: "FAILED",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      watchMode: false,
      taskFile: subagentTaskFile,
    };
    writeSubagentRecord(workspace, subagentRecord);

    await writeDispatchRecord({
      workspacePath: workspace,
      parentTaskId: "tk1000",
      childTaskId: "tk1001",
      client: "codex",
      subagentTaskId,
      checkpoint: {
        summary: "子任务进行中",
        nextAction: "继续子任务",
        updatedAt: Date.now(),
      },
    });

    const snapshot = await buildWorkRecoverySnapshot({
      workspacePath: workspace,
      parentTaskId: "tk1000",
    });

    expect(snapshot.workCapsule.taskId).toBe("tk1000");
    expect(snapshot.workCapsule.checkpoint.nextAction).toBe("继续子任务");
    expect(snapshot.workCapsule.checkpointSource).toBe("dispatch");
    expect(snapshot.workCapsule.activeDispatch.subtaskIds).toContain("tk1001");
    expect(snapshot.workCapsule.activeDispatch.blockedBy).toContain("tk1001");
    expect(snapshot.workCapsule.childTasks?.[0]?.workStatus).toBe("blocked");
    expect(snapshot.workCapsule.nextAction.type).toBe("resume");
  });

  it("A1b: 轻问题不强行进入 task path", () => {
    const result = classifyRequestPath({ requiresContinuity: false, requiresDispatch: false });
    expect(result).toBe("run");
  });

  it("A2: checkpoint 在 restart 后仍可作为恢复锚点", async () => {
    writeTaskDoc(workspace, "tk2000.doi.runtime.parent-task.md");

    const taskStoreDir = path.join(workspace, ".msgcode", "tasks");
    const taskStore = new TaskStore({ taskDir: taskStoreDir });
    const task = createTaskRecord({
      chatId: "chat-1",
      workspacePath: workspace,
      goal: "parent task",
    });
    await taskStore.createTask(task);
    await taskStore.updateTask(task.taskId, { status: "running" });
    await taskStore.updateTask(task.taskId, {
      status: "blocked",
      checkpoint: {
        summary: "等待恢复",
        nextAction: "补齐证据后继续",
        updatedAt: Date.now(),
      },
    });

    const restoredStore = new TaskStore({ taskDir: taskStoreDir });
    const runtimeTask = await restoredStore.getActiveTask("chat-1");

    const snapshot = await buildWorkRecoverySnapshot({
      workspacePath: workspace,
      parentTaskId: "tk2000",
      runtimeTask,
    });

    expect(snapshot.workCapsule.checkpointSource).toBe("runtime");
    expect(snapshot.workCapsule.checkpoint.nextAction).toBe("补齐证据后继续");
  });

  it("A3: dispatch 不抢任务文档状态，drift 会被记录", async () => {
    writeTaskDoc(workspace, "tk3000.doi.runtime.parent-task.md");
    writeTaskDoc(workspace, "tk3001.dne.runtime.child-task.md");

    await writeDispatchRecord({
      workspacePath: workspace,
      parentTaskId: "tk3000",
      childTaskId: "tk3001",
      client: "codex",
      checkpoint: {
        summary: "旧派单",
        nextAction: "不应覆盖任务文档",
        updatedAt: Date.now(),
      },
    });

    const snapshot = await buildWorkRecoverySnapshot({
      workspacePath: workspace,
      parentTaskId: "tk3000",
    });

    expect(snapshot.workCapsule.childTasks?.[0]?.workStatus).toBe("done");
    expect(snapshot.workCapsule.drift?.items.some((item) => item.code === "dispatch-stale-child")).toBe(true);
  });

  it("A3b: 即使子任务尚未派发，父任务文档里的 waiting_for 也应进入 work capsule", async () => {
    writeTaskDoc(
      workspace,
      "tk3100.doi.runtime.parent-task.md",
      `---
implicit:
  waiting_for: "tk3101"
---

# Goal

parent

## Child Tasks

- \`tk3101\`
`,
    );
    writeTaskDoc(workspace, "tk3101.tdo.runtime.child-task.md");

    const snapshot = await buildWorkRecoverySnapshot({
      workspacePath: workspace,
      parentTaskId: "tk3100",
    });

    expect(snapshot.dispatchRecords.length).toBe(0);
    expect(snapshot.workCapsule.childTasks?.some((task) => task.taskId === "tk3101")).toBe(true);
    expect(snapshot.workCapsule.childTasks?.find((task) => task.taskId === "tk3101")?.workStatus).toBe("pending");
    expect(snapshot.workCapsule.checkpoint.nextAction).toBe("派发子任务 tk3101");
    expect(snapshot.workCapsule.nextAction.type).toBe("dispatch");
    expect(snapshot.workCapsule.nextAction.params?.childTaskId).toBe("tk3101");
  });

  it("A3c: 多条 dispatch 并存时，恢复应使用最新 checkpoint", async () => {
    writeTaskDoc(workspace, "tk3200.doi.runtime.parent-task.md");
    writeTaskDoc(workspace, "tk3201.tdo.runtime.child-task-a.md");
    writeTaskDoc(workspace, "tk3202.tdo.runtime.child-task-b.md");

    await writeDispatchRecord({
      workspacePath: workspace,
      dispatchId: "dispatch-old",
      createdAt: "2026-03-18T00:00:00.000Z",
      updatedAt: "2026-03-18T00:00:00.000Z",
      parentTaskId: "tk3200",
      childTaskId: "tk3201",
      client: "codex",
      goal: "旧派单",
      cwd: workspace,
      acceptance: ["done"],
      checkpoint: {
        summary: "旧 checkpoint",
        nextAction: "不要再用这个",
        updatedAt: 1,
      },
    });

    await writeDispatchRecord({
      workspacePath: workspace,
      dispatchId: "dispatch-new",
      createdAt: "2026-03-18T00:10:00.000Z",
      updatedAt: "2026-03-18T00:10:00.000Z",
      parentTaskId: "tk3200",
      childTaskId: "tk3202",
      client: "codex",
      goal: "新派单",
      cwd: workspace,
      acceptance: ["done"],
      checkpoint: {
        summary: "新 checkpoint",
        nextAction: "继续最新子任务",
        updatedAt: 2,
      },
    });

    const snapshot = await buildWorkRecoverySnapshot({
      workspacePath: workspace,
      parentTaskId: "tk3200",
    });

    expect(snapshot.workCapsule.checkpointSource).toBe("dispatch");
    expect(snapshot.workCapsule.checkpoint.summary).toBe("新 checkpoint");
    expect(snapshot.workCapsule.checkpoint.nextAction).toBe("继续最新子任务");
  });

  it("single-writer: 同一 workspace 只允许一个写入者", async () => {
    const lock1 = await acquireWorkWriterLock(workspace);
    const lock2 = await acquireWorkWriterLock(workspace);

    expect(lock1.acquired).toBe(true);
    expect(lock2.acquired).toBe(false);

    await lock1.release();
  });

  it("drift: 损坏的 JSON 文件触发 conservative 模式", async () => {
    writeTaskDoc(workspace, "tk4000.doi.runtime.parent-task.md");

    // 写入一个损坏的 dispatch JSON
    const dispatchDir = path.join(workspace, ".msgcode", "dispatch");
    fs.writeFileSync(path.join(dispatchDir, "broken.json"), "{ invalid json", "utf8");

    // 写入一个损坏的 subagent JSON
    const subagentDir = path.join(workspace, ".msgcode", "subagents");
    fs.writeFileSync(path.join(subagentDir, "broken.json"), "also invalid", "utf8");

    const snapshot = await buildWorkRecoverySnapshot({
      workspacePath: workspace,
      parentTaskId: "tk4000",
    });

    // drift 应该捕获这两个错误
    expect(snapshot.drift).not.toBeNull();
    expect(snapshot.drift?.mode).toBe("conservative");
    expect(snapshot.drift?.items.some((item) => item.code === "dispatch-read-failed")).toBe(true);
    expect(snapshot.drift?.items.some((item) => item.code === "subagent-read-failed")).toBe(true);
  });
});
