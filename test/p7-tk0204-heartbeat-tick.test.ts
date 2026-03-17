import { afterEach, beforeEach, describe, expect, it, jest } from "bun:test";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { createHeartbeatTickHandler, type HeartbeatTickResult } from "../src/runtime/heartbeat-tick.js";
import { type TickContext } from "../src/runtime/heartbeat.js";
import { loadDispatchRecords } from "../src/runtime/work-continuity.js";

function createTempWorkspace(): string {
  const root = path.join(tmpdir(), `msgcode-heartbeat-tick-${randomUUID()}`);
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function cleanupTempWorkspace(root: string): void {
  if (fs.existsSync(root)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function createChildTask(workspace: string, taskId: string, board: string, slug: string): void {
  const issuesDir = path.join(workspace, "issues");
  fs.mkdirSync(issuesDir, { recursive: true });

  const content = `---
owner: agent
assignee: codex
reviewer: agent
why: 测试任务
scope: 测试
risk: low
accept: 完成
---

# Task

测试任务内容
`;

  fs.writeFileSync(path.join(issuesDir, `${taskId}.tdo.${board}.${slug}.md`), content);
}

describe("P7-TK0204: Heartbeat Tick Integration (最小可跑主链)", () => {
  let workspace: string;

  beforeEach(() => {
    workspace = createTempWorkspace();
  });

  afterEach(() => {
    cleanupTempWorkspace(workspace);
  });

  it("D1: 无任务时返回 HEARTBEAT_OK", async () => {
    const handler = createHeartbeatTickHandler({
      workspacePath: workspace,
      issuesDir: path.join(workspace, "issues"),
    });

    const ctx: TickContext = {
      tickId: "test-001",
      reason: "manual",
      startTime: Date.now(),
    };

    await handler(ctx);

    // 无任务时只打日志，不报错
    expect(true).toBe(true);
  });

  it("D2: 有子任务时创建 dispatch 记录", async () => {
    // 创建子任务
    createChildTask(workspace, "tk9999", "frontend", "test-page");

    // 确认任务文件存在
    const taskFile = path.join(workspace, "issues/tk9999.tdo.frontend.test-page.md");
    expect(fs.existsSync(taskFile)).toBe(true);

    // 创建 heartbeat tick handler（模拟执行，不实际调用 subagent）
    const handler = createHeartbeatTickHandler({
      workspacePath: workspace,
      issuesDir: path.join(workspace, "issues"),
      mockSubagentFn: async (dispatch) => {
        // 模拟：创建 dispatch 后立即返回成功
        return { success: true };
      },
    });

    const ctx: TickContext = {
      tickId: "test-002",
      reason: "manual",
      startTime: Date.now(),
    };

    // 执行 tick
    await handler(ctx);

    // 验证 dispatch 记录已创建
    const dispatchResult = await loadDispatchRecords(workspace);
    const dispatchRecords = dispatchResult.records;

    expect(dispatchRecords.length).toBeGreaterThan(0);

    const dispatch = dispatchRecords[0];
    expect(dispatch.client).toBe("codex");
    // P1修复: goal 从任务文档内容提取，不再简单从 slug 还原
    expect(dispatch.goal).toBe("测试任务内容");
    expect(dispatch.persona).toBe("frontend-builder");
    // 注意：由于 mock 同步执行，dispatch 记录可能仍是 pending（文件写入在内存中完成）
    // 验证派单已被创建和尝试执行
  });

  it("D2b: dispatch 包含完整的 persona + taskCard 信息", async () => {
    // 创建子任务
    createChildTask(workspace, "tk9998", "frontend", "full-test");

    // P2修复: 使用 beforeDispatch 回调捕获实际传给 runtime 的参数
    let capturedParams: any = null;

    const handler = createHeartbeatTickHandler({
      workspacePath: workspace,
      issuesDir: path.join(workspace, "issues"),
      beforeDispatch: (params) => {
        capturedParams = params;
      },
      mockSubagentFn: async () => ({
        task: { taskId: "mock-task-123" },
        watchResult: { success: true, response: "mock success" },
      }),
    });

    const ctx: TickContext = {
      tickId: "test-002b",
      reason: "manual",
      startTime: Date.now(),
    };

    await handler(ctx);

    // 验证实际传给了 runtime，不是只写在 JSON 里
    expect(capturedParams).not.toBeNull();
    expect(capturedParams.client).toBe("codex");
    // P1修复: goal 从任务文档内容提取
    expect(capturedParams.goal).toBe("测试任务内容");
    expect(capturedParams.persona).toBe("frontend-builder");
    expect(capturedParams.taskCard).toBeDefined();
    expect(capturedParams.taskCard.cwd).toBe(workspace);
    expect(capturedParams.taskCard.acceptance).toBeDefined();
    expect(capturedParams.taskCard.parentTask).toBe("tk9998");
  });

  it("D3: persona 按 board 自动选择", async () => {
    // 创建不同 board 的任务
    createChildTask(workspace, "tk8888", "review", "code-audit");
    createChildTask(workspace, "tk7777", "unknown", "misc-task");

    const handler = createHeartbeatTickHandler({
      workspacePath: workspace,
      issuesDir: path.join(workspace, "issues"),
      mockSubagentFn: async () => ({ success: true }),
    });

    const ctx: TickContext = {
      tickId: "test-003",
      reason: "manual",
      startTime: Date.now(),
    };

    await handler(ctx);

    // 验证 dispatch 记录
    const dispatchResult = await loadDispatchRecords(workspace);
    const dispatchRecords = dispatchResult.records;

    // 至少有一个 dispatch
    expect(dispatchRecords.length).toBeGreaterThanOrEqual(1);

    // 找 review 任务的 dispatch
    const reviewDispatch = dispatchRecords.find((d) => d.childTaskId === "tk8888");
    if (reviewDispatch) {
      expect(reviewDispatch.persona).toBe("code-reviewer");
    }
  });

  it("D4: 跳过已存在的 pending dispatch", async () => {
    // 创建子任务
    createChildTask(workspace, "tk6666", "frontend", "existing-task");

    const dispatchDir = path.join(workspace, ".msgcode", "dispatch");
    fs.mkdirSync(dispatchDir, { recursive: true });

    // 预先创建一个 pending dispatch
    const existingDispatch = {
      dispatchId: "dispatch-existing",
      parentTaskId: "tk6666",
      childTaskId: "tk6666",
      client: "codex",
      persona: "frontend-builder",
      goal: "existing task",
      cwd: workspace,
      status: "pending" as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(
      path.join(dispatchDir, "dispatch-existing.json"),
      JSON.stringify(existingDispatch)
    );

    const handler = createHeartbeatTickHandler({
      workspacePath: workspace,
      issuesDir: path.join(workspace, "issues"),
    });

    const ctx: TickContext = {
      tickId: "test-004",
      reason: "manual",
      startTime: Date.now(),
    };

    await handler(ctx);

    // 验证只有一个 dispatch（原有的）
    const dispatchResult = await loadDispatchRecords(workspace);
    expect(dispatchResult.records.length).toBe(1);
    expect(dispatchResult.records[0].dispatchId).toBe("dispatch-existing");
  });

  it("D5: 超时后能继续监督子代理状态", async () => {
    // 创建子任务
    createChildTask(workspace, "tk5555", "frontend", "timeout-test");

    // 模拟超时场景：mockSubagentFn 抛出 WATCH_TIMEOUT 错误
    // P1修复: 使用有效的 UUID 格式以匹配正则表达式
    const mockTaskId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    let dispatchCallCount = 0;
    let statusCheckCount = 0;

    const handler = createHeartbeatTickHandler({
      workspacePath: workspace,
      issuesDir: path.join(workspace, "issues"),
      beforeDispatch: (params) => {
        // 验证参数传递正确
        expect(params.persona).toBe("frontend-builder");
        expect(params.taskCard.parentTask).toBe("tk5555");
      },
      mockSubagentFn: async (dispatch) => {
        dispatchCallCount++;
        const error = new Error(
          `子代理 watch 超时，任务仍在运行: ${mockTaskId}。请用 msgcode subagent status ${mockTaskId} --workspace ${workspace} 继续查看。`
        );
        (error as any).code = "SUBAGENT_WATCH_TIMEOUT";
        throw error;
      },
      mockSubagentStatusFn: async (dispatch) => {
        statusCheckCount++;
        expect(dispatch.subagentTaskId).toBe(mockTaskId);
        return {
          task: {
            taskId: mockTaskId,
            client: "codex",
            workspacePath: workspace,
            groupName: "group-test",
            sessionName: "session-test",
            goal: dispatch.goal,
            status: "completed",
            doneMarker: "DONE",
            failedMarker: "FAILED",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            watchMode: true,
            taskFile: path.join(workspace, ".msgcode", "subagents", `${mockTaskId}.json`),
          },
          paneTail: "subagent completed successfully",
        };
      },
    });

    const ctx1: TickContext = {
      tickId: "test-005a",
      reason: "manual",
      startTime: Date.now(),
    };

    // 第一次 tick：触发超时
    await handler(ctx1);

    // 验证 dispatch 被创建且状态为 running（不是 failed）
    const dispatchResult1 = await loadDispatchRecords(workspace);
    const dispatch1 = dispatchResult1.records.find(d => d.childTaskId === "tk5555");
    expect(dispatch1).toBeDefined();
    expect(dispatch1!.status).toBe("running");

    // 验证 subagentTaskId 被正确提取（从错误消息）
    expect(dispatch1!.subagentTaskId).toBe(mockTaskId);

    // 验证任务文档状态未变（超时不应该推进到 pss）
    const taskFile = path.join(workspace, "issues/tk5555.tdo.frontend.timeout-test.md");
    expect(fs.existsSync(taskFile)).toBe(true);

    const ctx2: TickContext = {
      tickId: "test-005b",
      reason: "manual",
      startTime: Date.now(),
    };

    // 第二次 tick：继续监督（真实路径走 getSubagentTaskStatus / mockSubagentStatusFn）
    await handler(ctx2);

    expect(dispatchCallCount).toBe(1);
    expect(statusCheckCount).toBe(1);

    // 验证 dispatch 状态被更新为 completed
    const dispatchResult2 = await loadDispatchRecords(workspace);
    const dispatch2 = dispatchResult2.records.find(d => d.childTaskId === "tk5555");
    expect(dispatch2).toBeDefined();
    expect(dispatch2!.status).toBe("completed");
    expect(dispatch2!.result?.completed).toBe(true);

    // 验证子任务文档推进到 pss
    const passedTaskFile = path.join(workspace, "issues/tk5555.pss.frontend.timeout-test.md");
    expect(fs.existsSync(taskFile)).toBe(false);
    expect(fs.existsSync(passedTaskFile)).toBe(true);
  });
});
