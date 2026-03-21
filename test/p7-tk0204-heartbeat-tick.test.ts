import { afterEach, beforeEach, describe, expect, it, jest } from "bun:test";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { createHeartbeatTickHandler, type HeartbeatTickResult } from "../src/runtime/heartbeat-tick.js";
import { type TickContext } from "../src/runtime/heartbeat.js";
import { loadDispatchRecords } from "../src/runtime/work-continuity.js";
import { createWakeJob, createWakeRecord } from "../src/runtime/wake-store.js";
import { __resetBashRunnerTestDeps, __setBashRunnerTestDeps } from "../src/runners/bash-runner.js";

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

function createParentTask(workspace: string, taskId: string, board: string, slug: string, childTaskIds: string[]): void {
  const issuesDir = path.join(workspace, "issues");
  fs.mkdirSync(issuesDir, { recursive: true });

  const content = `---
owner: user
assignee: agent
reviewer: user
why: 测试父任务
scope: 测试
risk: low
accept: 完成
implicit:
  waiting_for: "${childTaskIds.join(", ")}"
  next_check: ""
  stale_since: ""
---

# Goal

测试父任务内容

## Child Tasks

${childTaskIds.map((id) => `- \`${id}\``).join("\n")}
`;

  fs.writeFileSync(path.join(issuesDir, `${taskId}.tdo.${board}.${slug}.md`), content);
}

function createChildTask(workspace: string, taskId: string, board: string, slug: string, parentTaskId?: string): void {
  const issuesDir = path.join(workspace, "issues");
  fs.mkdirSync(issuesDir, { recursive: true });

  const parentTaskSection = parentTaskId
    ? `\n## Parent Task\n\n- \`${parentTaskId}\`\n`
    : "";

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
${parentTaskSection}`;

  fs.writeFileSync(path.join(issuesDir, `${taskId}.tdo.${board}.${slug}.md`), content);
}

function createChildTaskWithVerify(workspace: string, taskId: string, board: string, slug: string): void {
  const issuesDir = path.join(workspace, "issues");
  fs.mkdirSync(issuesDir, { recursive: true });

  const content = `---
owner: agent
assignee: codex
reviewer: agent
why: 测试验证命令
scope: 测试
risk: low
accept: 完成
---

# Task

测试任务内容

## Verify

- \`printf verified\`
- \`node -e "process.exit(0)"\`
`;

  fs.writeFileSync(path.join(issuesDir, `${taskId}.tdo.${board}.${slug}.md`), content);
}

function createChildTaskWithFailingVerify(workspace: string, taskId: string, board: string, slug: string): void {
  const issuesDir = path.join(workspace, "issues");
  fs.mkdirSync(issuesDir, { recursive: true });

  const content = `---
owner: agent
assignee: codex
reviewer: agent
why: 测试验证失败
scope: 测试
risk: low
accept: 完成
---

# Task

测试任务内容

## Verify

- \`node -e "process.exit(7)"\`
`;

  fs.writeFileSync(path.join(issuesDir, `${taskId}.tdo.${board}.${slug}.md`), content);
}

function createChildTaskWithFollowUp(
  workspace: string,
  taskId: string,
  board: string,
  slug: string,
  followUpMessage: string
): void {
  const issuesDir = path.join(workspace, "issues");
  fs.mkdirSync(issuesDir, { recursive: true });

  const content = `---
owner: agent
assignee: codex
reviewer: agent
why: 测试 follow-up
scope: 测试
risk: low
accept: 完成
implicit:
  waiting_for: ""
  next_check: ""
  stale_since: ""
---

# Task

测试任务内容

## Follow-up

${followUpMessage}
`;

  fs.writeFileSync(path.join(issuesDir, `${taskId}.tdo.${board}.${slug}.md`), content);
}

describe("P7-TK0204: Heartbeat Tick Integration (最小可跑主链)", () => {
  let workspace: string;

  beforeEach(() => {
    workspace = createTempWorkspace();
    __setBashRunnerTestDeps({
      resolveManagedBashPath: () => "/bin/bash",
    });
  });

  afterEach(() => {
    __resetBashRunnerTestDeps();
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

  it("D1b: 每次 tick 后都应写出只读 STATUS 快照", async () => {
    createChildTask(workspace, "tk9997", "frontend", "status-page");
    createWakeJob(workspace, {
      id: "wk-job-001",
      kind: "recurring",
      schedule: { kind: "every", everyMs: 60_000, anchorMs: Date.now() },
      mode: "next-heartbeat",
      taskId: "tk9997",
      enabled: true,
    });
    createWakeRecord(workspace, {
      id: "wk-rec-001",
      jobId: "wk-job-001",
      status: "pending",
      path: "task",
      taskId: "tk9997",
      latePolicy: "run-if-missed",
    });
    const subagentDir = path.join(workspace, ".msgcode", "subagents");
    fs.mkdirSync(subagentDir, { recursive: true });
    fs.writeFileSync(
      path.join(subagentDir, "subagent-running.json"),
      JSON.stringify({
        taskId: "subagent-running",
        client: "codex",
        workspacePath: workspace,
        groupName: "group-status",
        sessionName: "session-status",
        goal: "继续完善状态页",
        status: "running",
        doneMarker: "DONE",
        failedMarker: "FAILED",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        watchMode: true,
        taskFile: path.join(subagentDir, "subagent-running.json"),
      }, null, 2),
    );

    const handler = createHeartbeatTickHandler({
      workspacePath: workspace,
      issuesDir: path.join(workspace, "issues"),
      mockSubagentFn: async () => ({ success: true }),
    });

    await handler({
      tickId: "test-001b",
      reason: "manual",
      startTime: Date.now(),
    });

    const statusPath = path.join(workspace, ".msgcode", "STATUS");
    expect(fs.existsSync(statusPath)).toBe(true);
    const statusContent = fs.readFileSync(statusPath, "utf8");
    expect(statusContent).toContain("# msgcode status @");
    expect(statusContent).toContain("## dispatch");
    expect(statusContent).toContain("tk9997");
    expect(statusContent).toContain("## wakes");
    expect(statusContent).toContain("wk-rec-001");
    expect(statusContent).toContain("## subagents");
    expect(statusContent).toContain("codex  running");
    expect(statusContent).toContain("## heartbeat");
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
        success: true,
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

  it("D3b: 任务文档里的 Verify 命令应透传到 dispatch 和 taskCard", async () => {
    createChildTaskWithVerify(workspace, "tk6666", "frontend", "verify-test");

    let capturedParams: any = null;
    const handler = createHeartbeatTickHandler({
      workspacePath: workspace,
      issuesDir: path.join(workspace, "issues"),
      beforeDispatch: (params) => {
        capturedParams = params;
      },
      mockSubagentFn: async () => ({
        success: true,
        task: { taskId: "mock-task-verify-123" },
        watchResult: { success: true, response: "verified" },
      }),
    });

    await handler({
      tickId: "test-003b",
      reason: "manual",
      startTime: Date.now(),
    });

    const dispatchResult = await loadDispatchRecords(workspace);
    const dispatch = dispatchResult.records.find((record) => record.childTaskId === "tk6666");

    expect(dispatch?.verificationCommands).toEqual([
      "printf verified",
      "node -e \"process.exit(0)\"",
    ]);
    expect(capturedParams?.taskCard?.verification).toEqual([
      "printf verified",
      "node -e \"process.exit(0)\"",
    ]);
  });

  it("D3d: Verify 失败时任务应停在 rvw，并把证据写入 .msgcode/evidence", async () => {
    createChildTaskWithFailingVerify(workspace, "tk6667", "frontend", "verify-fail");

    const handler = createHeartbeatTickHandler({
      workspacePath: workspace,
      issuesDir: path.join(workspace, "issues"),
      mockSubagentFn: async () => ({
        success: true,
        task: { taskId: "mock-task-verify-fail-123" },
        watchResult: { success: true, response: "verified" },
      }),
    });

    await handler({
      tickId: "test-003d",
      reason: "manual",
      startTime: Date.now(),
    });

    expect(fs.existsSync(path.join(workspace, "issues", "tk6667.rvw.frontend.verify-fail.md"))).toBe(true);
    expect(fs.existsSync(path.join(workspace, "issues", "tk6667.pss.frontend.verify-fail.md"))).toBe(false);

    const evidencePath = path.join(workspace, ".msgcode", "evidence", "tk6667.json");
    expect(fs.existsSync(evidencePath)).toBe(true);
    const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8")) as {
      exitCode: number;
      ok: boolean;
      commands: Array<{ exitCode: number; stdoutTail: string; stderrTail: string }>;
    };
    expect(evidence.ok).toBe(false);
    expect(evidence.exitCode).toBe(7);
    expect(evidence.commands[0]?.exitCode).toBe(7);
    expect(evidence.commands[0]).toHaveProperty("stdoutTail");
    expect(evidence.commands[0]).toHaveProperty("stderrTail");

    const evidenceDir = path.join(workspace, ".msgcode", "evidence");
    const snapshots = fs.readdirSync(evidenceDir).filter((name) => /^verify-\d{8}T\d{6}Z-[a-z0-9]+\.json$/i.test(name));
    expect(snapshots.length).toBe(1);
  });

  it("D3e: Verify 连续失败时任务应从 rvw 推进到 bkd", async () => {
    createChildTaskWithFailingVerify(workspace, "tk6668", "frontend", "verify-blocked");

    const handler = createHeartbeatTickHandler({
      workspacePath: workspace,
      issuesDir: path.join(workspace, "issues"),
      mockSubagentFn: async () => ({
        success: true,
        task: { taskId: "mock-task-verify-blocked-123" },
        watchResult: { success: true, response: "verified" },
      }),
    });

    await handler({
      tickId: "test-003e-1",
      reason: "manual",
      startTime: Date.now(),
    });

    expect(fs.existsSync(path.join(workspace, "issues", "tk6668.rvw.frontend.verify-blocked.md"))).toBe(true);

    await handler({
      tickId: "test-003e-2",
      reason: "manual",
      startTime: Date.now(),
    });

    expect(fs.existsSync(path.join(workspace, "issues", "tk6668.rvw.frontend.verify-blocked.md"))).toBe(false);
    expect(fs.existsSync(path.join(workspace, "issues", "tk6668.bkd.frontend.verify-blocked.md"))).toBe(true);
    expect(fs.existsSync(path.join(workspace, ".msgcode", "evidence", "tk6668.json"))).toBe(true);
  });

  it("D3c: 非 git workspace 完成 dispatch 后应推进子任务与父任务", async () => {
    createParentTask(workspace, "tk6650", "runtime", "parent-review", ["tk6651"]);
    createChildTask(workspace, "tk6651", "frontend", "child-proof", "tk6650");

    const handler = createHeartbeatTickHandler({
      workspacePath: workspace,
      issuesDir: path.join(workspace, "issues"),
      mockSubagentFn: async () => ({
        success: true,
        task: { taskId: "mock-task-6651" },
        watchResult: { success: true, response: "done" },
      }),
    });

    await handler({
      tickId: "test-003c",
      reason: "manual",
      startTime: Date.now(),
    });

    expect(fs.existsSync(path.join(workspace, "issues", "tk6651.pss.frontend.child-proof.md"))).toBe(true);
    expect(fs.existsSync(path.join(workspace, "issues", "tk6650.rvw.runtime.parent-review.md"))).toBe(true);
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

  it("D6: 子任务完成后应推进父任务到 rvw，并写入真实 parentTaskId", async () => {
    createParentTask(workspace, "tk4444", "runtime", "parent-goal", ["tk4445"]);
    createChildTask(workspace, "tk4445", "frontend", "child-work", "tk4444");

    const handler = createHeartbeatTickHandler({
      workspacePath: workspace,
      issuesDir: path.join(workspace, "issues"),
      mockSubagentFn: async () => ({
        success: true,
        task: { taskId: "mock-task-parent-001" },
        watchResult: { success: true, response: "mock success" },
      }),
    });

    const ctx: TickContext = {
      tickId: "test-006",
      reason: "manual",
      startTime: Date.now(),
    };

    await handler(ctx);

    const dispatchResult = await loadDispatchRecords(workspace);
    const dispatch = dispatchResult.records.find((d) => d.childTaskId === "tk4445");
    expect(dispatch).toBeDefined();
    expect(dispatch!.parentTaskId).toBe("tk4444");
    expect(dispatch!.status).toBe("completed");

    const childPassedFile = path.join(workspace, "issues/tk4445.pss.frontend.child-work.md");
    const parentReviewFile = path.join(workspace, "issues/tk4444.rvw.runtime.parent-goal.md");
    expect(fs.existsSync(childPassedFile)).toBe(true);
    expect(fs.existsSync(parentReviewFile)).toBe(true);
  });

  it("D6b: running 子代理的 follow-up 只应发送一次，并写回 dispatch", async () => {
    createChildTaskWithFollowUp(workspace, "tk4446", "frontend", "follow-up-once", "请继续补上验证截图。");

    const dispatchDir = path.join(workspace, ".msgcode", "dispatch");
    fs.mkdirSync(dispatchDir, { recursive: true });

    const runningDispatch = {
      dispatchId: "dispatch-follow-up",
      parentTaskId: "tk4446",
      childTaskId: "tk4446",
      client: "codex",
      persona: "frontend-builder",
      subagentTaskId: "mock-subagent-follow-up",
      goal: "测试任务内容",
      cwd: workspace,
      acceptance: ["完成"],
      status: "running" as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      filePath: path.join(dispatchDir, "dispatch-follow-up.json"),
    };
    fs.writeFileSync(runningDispatch.filePath, JSON.stringify(runningDispatch, null, 2));

    const sentMessages: string[] = [];
    const handler = createHeartbeatTickHandler({
      workspacePath: workspace,
      issuesDir: path.join(workspace, "issues"),
      mockSubagentStatusFn: async () => ({
        task: {
          taskId: "mock-subagent-follow-up",
          client: "codex",
          workspacePath: workspace,
          groupName: "group-follow-up",
          sessionName: "session-follow-up",
          goal: "测试任务内容",
          status: "running",
          doneMarker: "DONE",
          failedMarker: "FAILED",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          watchMode: true,
          taskFile: path.join(workspace, ".msgcode", "subagents", "mock-subagent-follow-up.json"),
        },
        paneTail: "still running",
      }),
      mockSubagentSayFn: async (_dispatch, message) => {
        sentMessages.push(message);
        return { success: true, response: "收到，继续执行" };
      },
    });

    await handler({
      tickId: "test-006b-1",
      reason: "manual",
      startTime: Date.now(),
    });

    await handler({
      tickId: "test-006b-2",
      reason: "manual",
      startTime: Date.now(),
    });

    expect(sentMessages).toEqual(["请继续补上验证截图。"]);

    const dispatchResult = await loadDispatchRecords(workspace);
    const dispatch = dispatchResult.records.find((record) => record.dispatchId === "dispatch-follow-up");
    expect(dispatch?.lastSupervisorMessageHash).toBeDefined();
    expect(dispatch?.lastSupervisorMessageAt).toBeDefined();
    expect(dispatch?.status).toBe("running");
  });

  it("D7: 有 waiting_for 依赖时，应优先派发已解锁的子任务", async () => {
    createParentTask(workspace, "tk4430", "runtime", "dependency-parent", ["tk4431", "tk4432"]);
    createChildTask(workspace, "tk4431", "web", "first-step", "tk4430");
    createChildTask(workspace, "tk4432", "web", "second-step", "tk4430");

    const secondTaskPath = path.join(workspace, "issues", "tk4432.tdo.web.second-step.md");
    const secondTaskContent = fs.readFileSync(secondTaskPath, "utf8");
    fs.writeFileSync(
      secondTaskPath,
      secondTaskContent.replace('waiting_for: ""', 'waiting_for: "tk4431"')
    );

    const handler = createHeartbeatTickHandler({
      workspacePath: workspace,
      issuesDir: path.join(workspace, "issues"),
      mockSubagentFn: async () => ({
        success: true,
        task: { taskId: "mock-task-dependency-001" },
        watchResult: { success: true, response: "mock success" },
      }),
    });

    const ctx: TickContext = {
      tickId: "test-007",
      reason: "manual",
      startTime: Date.now(),
    };

    await handler(ctx);

    const dispatchResult = await loadDispatchRecords(workspace);
    expect(dispatchResult.records.length).toBe(1);
    expect(dispatchResult.records[0]?.childTaskId).toBe("tk4431");
    expect(fs.existsSync(path.join(workspace, "issues", "tk4431.pss.web.first-step.md"))).toBe(true);
    expect(fs.existsSync(path.join(workspace, "issues", "tk4432.tdo.web.second-step.md"))).toBe(true);
  });
});
