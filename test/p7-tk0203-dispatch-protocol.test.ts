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
});
