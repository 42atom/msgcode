import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import {
  writeDispatchRecord,
  getDispatchRecordsByStatus,
  getPendingDispatchCount,
  hasActionableDispatches,
  loadDispatchRecords,
} from "../src/runtime/work-continuity.js";
import { createTaskSupervisor } from "../src/runtime/task-supervisor.js";
import { TaskStore } from "../src/runtime/task-store.js";
import { createTaskRecord } from "../src/runtime/task-types.js";
import { ensureScheduleDir, getSchedulesDir } from "../src/runtime/schedule-wake.js";

function createTempWorkspace(): string {
  const root = path.join(tmpdir(), `msgcode-dispatch-${randomUUID()}`);
  fs.mkdirSync(root, { recursive: true });
  // Create required directories
  fs.mkdirSync(path.join(root, ".msgcode", "dispatch"), { recursive: true });
  fs.mkdirSync(path.join(root, "issues"), { recursive: true });
  return root;
}

function cleanupTempWorkspace(root: string): void {
  if (fs.existsSync(root)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function writeTaskDoc(workspace: string, fileName: string): string {
  const filePath = path.join(workspace, "issues", fileName);
  fs.writeFileSync(filePath, "# task\n", "utf8");
  return filePath;
}

describe("Doc-First Dispatch Protocol", () => {
  let workspace: string;

  beforeEach(() => {
    workspace = createTempWorkspace();
  });

  afterEach(() => {
    cleanupTempWorkspace(workspace);
  });

  describe("Dispatch Record Creation", () => {
    it("creates dispatch record with all required fields", async () => {
      const dispatch = await writeDispatchRecord({
        workspacePath: workspace,
        parentTaskId: "tk0001",
        childTaskId: "tk0002",
        client: "codex",
        goal: "Implement login page",
        cwd: "/workspace/path",
        acceptance: ["page-runs", "form-validates"],
      });

      expect(dispatch.dispatchId).toBeDefined();
      expect(dispatch.parentTaskId).toBe("tk0001");
      expect(dispatch.childTaskId).toBe("tk0002");
      expect(dispatch.client).toBe("codex");
      expect(dispatch.status).toBe("pending");
      expect(dispatch.createdAt).toBeDefined();
      expect(dispatch.updatedAt).toBeDefined();
    });

    it("creates dispatch with optional fields", async () => {
      const dispatch = await writeDispatchRecord({
        workspacePath: workspace,
        parentTaskId: "tk0001",
        childTaskId: "tk0002",
        client: "claude-code",
        persona: "frontend-builder",
        goal: "Implement dashboard",
        cwd: "/workspace/path",
        constraints: ["no-backend-change"],
        acceptance: ["dashboard-runs"],
        expectedArtifacts: ["/path/to/dashboard.js"],
      });

      expect(dispatch.persona).toBe("frontend-builder");
      expect(dispatch.constraints).toEqual(["no-backend-change"]);
      expect(dispatch.expectedArtifacts).toEqual(["/path/to/dashboard.js"]);
    });

    it("preserves custom dispatchId", async () => {
      const customId = "dispatch-custom-123";
      const dispatch = await writeDispatchRecord({
        workspacePath: workspace,
        dispatchId: customId,
        parentTaskId: "tk0001",
        childTaskId: "tk0002",
        client: "codex",
        goal: "Test",
        cwd: "/workspace",
        acceptance: ["done"],
      });

      expect(dispatch.dispatchId).toBe(customId);
    });
  });

  describe("Dispatch Status Filtering", () => {
    it("filters by single status", async () => {
      await writeDispatchRecord({
        workspacePath: workspace,
        parentTaskId: "tk0001",
        childTaskId: "tk0002",
        client: "codex",
        goal: "Task 1",
        cwd: "/workspace",
        acceptance: ["done"],
      });

      await writeDispatchRecord({
        workspacePath: workspace,
        parentTaskId: "tk0001",
        childTaskId: "tk0003",
        client: "codex",
        goal: "Task 2",
        cwd: "/workspace",
        acceptance: ["done"],
      });

      // Manually set one to running by updating
      const { records } = await loadDispatchRecords(workspace);
      const { updateDispatchStatus } = await import("../src/runtime/work-continuity.js");
      await updateDispatchStatus(workspace, records[0].dispatchId, "running");

      const pending = await getDispatchRecordsByStatus(workspace, "pending");
      expect(pending.length).toBe(1);

      const running = await getDispatchRecordsByStatus(workspace, "running");
      expect(running.length).toBe(1);
    });

    it("filters by multiple statuses", async () => {
      await writeDispatchRecord({
        workspacePath: workspace,
        parentTaskId: "tk0001",
        childTaskId: "tk0002",
        client: "codex",
        goal: "Task 1",
        cwd: "/workspace",
        acceptance: ["done"],
      });

      const { records } = await loadDispatchRecords(workspace);
      const { updateDispatchStatus } = await import("../src/runtime/work-continuity.js");
      await updateDispatchStatus(workspace, records[0].dispatchId, "running");

      const pendingOrRunning = await getDispatchRecordsByStatus(workspace, ["pending", "running"]);
      expect(pendingOrRunning.length).toBe(1);
    });
  });

  describe("Dispatch Count", () => {
    it("counts pending dispatches", async () => {
      await writeDispatchRecord({
        workspacePath: workspace,
        parentTaskId: "tk0001",
        childTaskId: "tk0002",
        client: "codex",
        goal: "Task 1",
        cwd: "/workspace",
        acceptance: ["done"],
      });

      await writeDispatchRecord({
        workspacePath: workspace,
        parentTaskId: "tk0001",
        childTaskId: "tk0003",
        client: "codex",
        goal: "Task 2",
        cwd: "/workspace",
        acceptance: ["done"],
      });

      const count = await getPendingDispatchCount(workspace);
      expect(count).toBe(2);
    });

    it("returns 0 when no dispatches", async () => {
      const count = await getPendingDispatchCount(workspace);
      expect(count).toBe(0);
    });

    it("hasActionableDispatches returns true when pending", async () => {
      await writeDispatchRecord({
        workspacePath: workspace,
        parentTaskId: "tk0001",
        childTaskId: "tk0002",
        client: "codex",
        goal: "Task 1",
        cwd: "/workspace",
        acceptance: ["done"],
      });

      const hasAction = await hasActionableDispatches(workspace);
      expect(hasAction).toBe(true);
    });

    it("hasActionableDispatches returns false when empty", async () => {
      const hasAction = await hasActionableDispatches(workspace);
      expect(hasAction).toBe(false);
    });
  });

  describe("Dispatch Status Update", () => {
    it("updates dispatch status", async () => {
      const dispatch = await writeDispatchRecord({
        workspacePath: workspace,
        parentTaskId: "tk0001",
        childTaskId: "tk0002",
        client: "codex",
        goal: "Task 1",
        cwd: "/workspace",
        acceptance: ["done"],
      });

      const { updateDispatchStatus } = await import("../src/runtime/work-continuity.js");
      const updated = await updateDispatchStatus(
        workspace,
        dispatch.dispatchId,
        "completed",
        {
          completed: true,
          artifacts: ["/path/to/output"],
          summary: "Task completed",
        }
      );

      expect(updated).not.toBeNull();
      expect(updated!.status).toBe("completed");
      expect(updated!.result?.completed).toBe(true);
      expect(updated!.result?.artifacts).toEqual(["/path/to/output"]);
    });

    it("returns null for non-existent dispatch", async () => {
      const { updateDispatchStatus } = await import("../src/runtime/work-continuity.js");
      const result = await updateDispatchStatus(workspace, "non-existent", "completed");
      expect(result).toBeNull();
    });
  });

  describe("Heartbeat Integration", () => {
    it("dispatch records can be read by heartbeat", async () => {
      await writeDispatchRecord({
        workspacePath: workspace,
        parentTaskId: "tk0001",
        childTaskId: "tk0002",
        client: "codex",
        goal: "Task for heartbeat",
        cwd: "/workspace",
        acceptance: ["done"],
      });

      // Simulate heartbeat reading
      const { records, errors } = await loadDispatchRecords(workspace);
      expect(errors.length).toBe(0);
      expect(records.length).toBe(1);
      expect(records[0].goal).toBe("Task for heartbeat");
    });

    it("dispatch records are loaded in stable createdAt order", async () => {
      await writeDispatchRecord({
        workspacePath: workspace,
        dispatchId: "dispatch-newer",
        createdAt: "2026-03-16T10:10:00.000Z",
        parentTaskId: "tk0001",
        childTaskId: "tk0003",
        client: "codex",
        goal: "Newer dispatch",
        cwd: "/workspace",
        acceptance: ["done"],
      });

      await writeDispatchRecord({
        workspacePath: workspace,
        dispatchId: "dispatch-older",
        createdAt: "2026-03-16T10:00:00.000Z",
        parentTaskId: "tk0001",
        childTaskId: "tk0002",
        client: "codex",
        goal: "Older dispatch",
        cwd: "/workspace",
        acceptance: ["done"],
      });

      const { records, errors } = await loadDispatchRecords(workspace);
      expect(errors.length).toBe(0);
      expect(records.map((record) => record.dispatchId)).toEqual([
        "dispatch-older",
        "dispatch-newer",
      ]);
    });

    it("completed dispatch does not count as actionable", async () => {
      const dispatch = await writeDispatchRecord({
        workspacePath: workspace,
        parentTaskId: "tk0001",
        childTaskId: "tk0002",
        client: "codex",
        goal: "Completed task",
        cwd: "/workspace",
        acceptance: ["done"],
      });

      const { updateDispatchStatus } = await import("../src/runtime/work-continuity.js");
      await updateDispatchStatus(workspace, dispatch.dispatchId, "completed");

      const hasAction = await hasActionableDispatches(workspace);
      expect(hasAction).toBe(false);
    });
  });

  describe("TaskSupervisor Integration", () => {
    it("heartbeat 会优先扫描 actionable dispatch，并把 WorkCapsule 透传给执行器", async () => {
      writeTaskDoc(workspace, "tk0001.doi.runtime.parent-task.md");
      writeTaskDoc(workspace, "tk0002.tdo.runtime.child-task.md");

      await writeDispatchRecord({
        workspacePath: workspace,
        parentTaskId: "tk0001",
        childTaskId: "tk0002",
        client: "codex",
        goal: "继续推进父任务",
        cwd: workspace,
        acceptance: ["done"],
        checkpoint: {
          summary: "父任务待继续",
          nextAction: "先检查子任务交付",
          updatedAt: Date.now(),
        },
      });

      const taskDir = path.join(workspace, ".msgcode", "tasks");
      const eventQueueDir = path.join(workspace, ".msgcode", "event-queue");
      fs.mkdirSync(taskDir, { recursive: true });
      fs.mkdirSync(eventQueueDir, { recursive: true });

      let observedTaskId: string | undefined;
      let observedCapsuleTaskId: string | undefined;
      let observedSubtasks: string[] = [];

      const supervisor = createTaskSupervisor({
        taskDir,
        eventQueueDir,
        workspacePath: workspace,
        heartbeatIntervalMs: 0,
        executeTaskTurn: async (task, context) => {
          observedTaskId = task.taskId;
          observedCapsuleTaskId = context.capsule?.taskId;
          observedSubtasks = context.capsule?.activeDispatch.subtaskIds ?? [];
          return {
            answer: "任务已完成",
            actionJournal: [],
            verifyResult: {
              ok: true,
              evidence: "dispatch-ok",
            },
          };
        },
      });

      await supervisor.start();
      try {
        await supervisor.handleHeartbeatTick({
          tickId: "tick-dispatch-1",
          reason: "manual",
          startTime: Date.now(),
        });
      } finally {
        await supervisor.stop();
      }

      expect(observedTaskId).toBe("tk0001");
      expect(observedCapsuleTaskId).toBe("tk0001");
      expect(observedSubtasks).toEqual(["tk0002"]);

      const { records } = await loadDispatchRecords(workspace);
      expect(records[0]?.status).toBe("completed");
      expect(records[0]?.checkpoint?.summary).toBe("任务已完成");
    });

    it("有 actionable dispatch 时，优先于旧的 runtime active task", async () => {
      writeTaskDoc(workspace, "tk0001.doi.runtime.parent-task.md");
      writeTaskDoc(workspace, "tk0002.tdo.runtime.child-task.md");

      await writeDispatchRecord({
        workspacePath: workspace,
        parentTaskId: "tk0001",
        childTaskId: "tk0002",
        client: "codex",
        goal: "先处理 dispatch",
        cwd: workspace,
        acceptance: ["done"],
      });

      const taskDir = path.join(workspace, ".msgcode", "tasks");
      const eventQueueDir = path.join(workspace, ".msgcode", "event-queue");
      fs.mkdirSync(taskDir, { recursive: true });
      fs.mkdirSync(eventQueueDir, { recursive: true });

      const executedTaskIds: string[] = [];
      const supervisor = createTaskSupervisor({
        taskDir,
        eventQueueDir,
        workspacePath: workspace,
        heartbeatIntervalMs: 0,
        executeTaskTurn: async (task) => {
          executedTaskIds.push(task.taskId);
          return {
            answer: "done",
            actionJournal: [],
            verifyResult: {
              ok: true,
              evidence: "ok",
            },
          };
        },
      });

      await supervisor.start();
      try {
        const created = await supervisor.createTask("chat-legacy", workspace, "旧 runtime task");
        expect(created.ok).toBe(true);

        await supervisor.handleHeartbeatTick({
          tickId: "tick-dispatch-priority",
          reason: "manual",
          startTime: Date.now(),
        });

        expect(executedTaskIds[0]).toBe("tk0001");
        if (created.ok) {
          const legacyTask = await supervisor.getTaskStatus(created.task.taskId);
          expect(legacyTask?.status).toBe("pending");
        }
      } finally {
        await supervisor.stop();
      }
    });

    it("有现成 runtime checkpoint 时，dispatch 恢复应保留更精确的恢复指针", async () => {
      writeTaskDoc(workspace, "tk0001.doi.runtime.parent-task.md");
      writeTaskDoc(workspace, "tk0002.tdo.runtime.child-task.md");

      await writeDispatchRecord({
        workspacePath: workspace,
        parentTaskId: "tk0001",
        childTaskId: "tk0002",
        client: "codex",
        goal: "继续推进父任务",
        cwd: workspace,
        acceptance: ["done"],
        checkpoint: {
          summary: "dispatch checkpoint",
          nextAction: "读取最新派单结果",
          updatedAt: Date.now(),
        },
      });

      const taskDir = path.join(workspace, ".msgcode", "tasks");
      const eventQueueDir = path.join(workspace, ".msgcode", "event-queue");
      fs.mkdirSync(taskDir, { recursive: true });
      fs.mkdirSync(eventQueueDir, { recursive: true });

      const taskStore = new TaskStore({ taskDir });
      const runtimeTask = {
        ...createTaskRecord({
          chatId: "tk0001",
          workspacePath: workspace,
          goal: "父任务 runtime cache",
        }),
        taskId: "tk0001",
      };
      const created = await taskStore.createTask(runtimeTask);
      expect(created.ok).toBe(true);
      const running = await taskStore.updateTask("tk0001", {
        status: "running",
      });
      expect(running.ok).toBe(true);
      await taskStore.updateTask("tk0001", {
        status: "blocked",
        checkpoint: {
          currentPhase: "blocked",
          summary: "等待补证据",
          nextAction: "补齐 verify 证据后继续",
          updatedAt: Date.now(),
        },
      });

      let observedNextAction: string | undefined;
      const supervisor = createTaskSupervisor({
        taskDir,
        eventQueueDir,
        workspacePath: workspace,
        heartbeatIntervalMs: 0,
        executeTaskTurn: async (_task, context) => {
          observedNextAction = context.capsule?.checkpoint.nextAction;
          return {
            answer: "done",
            actionJournal: [],
            verifyResult: {
              ok: true,
              evidence: "ok",
            },
          };
        },
      });

      await supervisor.start();
      try {
        await supervisor.handleHeartbeatTick({
          tickId: "tick-dispatch-runtime-checkpoint",
          reason: "manual",
          startTime: Date.now(),
        });
      } finally {
        await supervisor.stop();
      }

      expect(observedNextAction).toBe("补齐 verify 证据后继续");
    });
  });
});
