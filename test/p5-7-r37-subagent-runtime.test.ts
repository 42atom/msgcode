import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let startHandler = async () => "started";
let capturePaneHandler = async () => "";
let sendMessageHandler = async () => ({ success: true });
let sendEscapeHandler = async () => "已发送 ESC 中断";
let handleTmuxSendHandler = async () => ({ success: true, response: "" });

const startMock = mock((...args: unknown[]) => startHandler(...args));
const capturePaneMock = mock((...args: unknown[]) => capturePaneHandler(...args));
const sendMessageMock = mock((...args: unknown[]) => sendMessageHandler(...args));
const sendEscapeMock = mock((...args: unknown[]) => sendEscapeHandler(...args));
const handleTmuxSendMock = mock((...args: unknown[]) => handleTmuxSendHandler(...args));

mock.module("../src/tmux/session.js", () => ({
  TmuxSession: {
    getSessionName: (groupName: string) => `msgcode-${groupName}`,
    start: startMock,
    capturePane: capturePaneMock,
  },
}));

mock.module("../src/tmux/sender.js", () => ({
  sendMessage: sendMessageMock,
  sendEscape: sendEscapeMock,
}));

mock.module("../src/tmux/responder.js", () => ({
  handleTmuxSend: handleTmuxSendMock,
}));

const {
  runSubagentTask,
  sendSubagentMessage,
  listSubagentTasks,
  getSubagentTaskStatus,
  stopSubagentTask,
} = await import("../src/runtime/subagent.js");

describe("P5.7-R37: subagent runtime", () => {
  let workspacePath = "";

  function createIssueFile(taskId: string, state: string, board: string, slug: string, content: string): void {
    const issuesDir = path.join(workspacePath, "issues");
    fs.mkdirSync(issuesDir, { recursive: true });
    fs.writeFileSync(path.join(issuesDir, `${taskId}.${state}.${board}.${slug}.md`), content);
  }

  beforeEach(() => {
    workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), "msgcode-subagent-"));
    startHandler = async () => '已启动 tmux 会话 "msgcode-subagent"\nCodex 已就绪';
    capturePaneHandler = async () => "";
    sendMessageHandler = async () => ({ success: true });
    sendEscapeHandler = async () => "已发送 ESC 中断";
    handleTmuxSendHandler = async () => ({ success: true, response: "" });
    startMock.mockClear();
    capturePaneMock.mockClear();
    sendMessageMock.mockClear();
    sendEscapeMock.mockClear();
    handleTmuxSendMock.mockClear();
  });

  afterEach(() => {
    fs.rmSync(workspacePath, { recursive: true, force: true });
  });

  it("run --watch 只有检测到完成 marker 后才标记 completed", async () => {
    let taskMarker = "";
    handleTmuxSendHandler = async (_groupName: string, prompt: string) => {
      taskMarker = prompt.match(/MSGCODE_SUBAGENT_DONE\s+([\w-]+)/)?.[0] ?? "";
      return {
        success: true,
        response: "已切换到工作目录，开始执行任务",
      };
    };
    let captureCount = 0;
    capturePaneHandler = async () => {
      captureCount++;
      if (captureCount === 1) {
        return "正在生成 HTML 和样式文件";
      }
      return `pane tail\n${taskMarker}`;
    };

    const result = await runSubagentTask({
      client: "codex",
      goal: "创建一个贪吃蛇 HTML 游戏",
      workspace: workspacePath,
      watch: true,
      timeoutMs: 4000,
    });

    expect(startMock).toHaveBeenCalled();
    expect(handleTmuxSendMock).toHaveBeenCalled();
    expect(captureCount).toBeGreaterThan(1);
    expect(result.task.status).toBe("completed");
    expect(fs.existsSync(result.task.taskFile)).toBe(true);
    const saved = JSON.parse(fs.readFileSync(result.task.taskFile, "utf8")) as { status: string; goal: string };
    expect(saved.status).toBe("completed");
    expect(saved.goal).toContain("贪吃蛇");
  });

  it("run --watch 未检测到完成 marker 时应保持 running 并报超时", async () => {
    handleTmuxSendHandler = async () => ({
      success: true,
      response: "已切换到工作目录，开始执行任务",
    });
    capturePaneHandler = async () => "仍在生成资源文件";

    await expect(
      runSubagentTask({
        client: "claude-code",
        goal: "创建一个最小 HTML 项目",
        workspace: workspacePath,
        watch: true,
        timeoutMs: 20,
      }),
    ).rejects.toMatchObject({
      code: "SUBAGENT_WATCH_TIMEOUT",
    });

    const files = fs.readdirSync(path.join(workspacePath, ".msgcode", "subagents"));
    expect(files.length).toBe(1);
    const saved = JSON.parse(
      fs.readFileSync(path.join(workspacePath, ".msgcode", "subagents", files[0] ?? ""), "utf8"),
    ) as { status: string; lastPaneTail?: string };
    expect(saved.status).toBe("running");
    expect(saved.lastPaneTail).toContain("仍在生成资源文件");
  });

  it("run --watch 若 responder 已返回 done marker，应直接完成而不依赖后续 pane 轮询", async () => {
    let taskMarker = "";
    handleTmuxSendHandler = async (_groupName: string, prompt: string) => {
      taskMarker = prompt.match(/MSGCODE_SUBAGENT_DONE\s+([\w-]+)/)?.[0] ?? "";
      return {
        success: true,
        response: `执行完成\n${taskMarker}`,
      };
    };
    capturePaneHandler = async () => {
      throw new Error("不应再依赖 pane 轮询拿 marker");
    };

    const result = await runSubagentTask({
      client: "codex",
      goal: "创建一个最小 HTML 页面",
      workspace: workspacePath,
      watch: true,
      timeoutMs: 2000,
    });

    expect(result.task.status).toBe("completed");
    expect(result.watchResult?.success).toBe(true);
    expect(result.watchResult?.response).toContain(taskMarker);
  });

  it("run --watch 应把 persona 文档和 taskCard 注入委派 prompt", async () => {
    createIssueFile(
      "tk1233",
      "tdo",
      "runtime",
      "parent-goal",
      `---
owner: user
assignee: agent
reviewer: user
---

# Goal

这是父任务的全貌摘要，用来约束当前子任务。
`,
    );
    createIssueFile(
      "tk1234",
      "tdo",
      "frontend",
      "child-task",
      `---
owner: agent
assignee: codex
reviewer: agent
---

# Task

创建一个最小 HTML 页面

## Parent Task

- \`tk1233\`
`,
    );
    fs.mkdirSync(path.join(workspacePath, ".msgcode", "evidence"), { recursive: true });
    fs.writeFileSync(
      path.join(workspacePath, ".msgcode", "evidence", "tk1234.json"),
      JSON.stringify({
        taskId: "tk1234",
        ok: false,
        exitCode: 7,
        commands: [
          {
            command: "npm test",
            ok: false,
            exitCode: 7,
            stderr: "Assertion failed: expected banner text to appear in page output.",
          },
        ],
      }),
    );

    let capturedPrompt = "";
    handleTmuxSendHandler = async (_groupName: string, prompt: string) => {
      capturedPrompt = prompt;
      const taskMarker = prompt.match(/MSGCODE_SUBAGENT_DONE\s+([\w-]+)/)?.[0] ?? "";
      return {
        success: true,
        response: `执行完成\n${taskMarker}`,
      };
    };

    const result = await runSubagentTask({
      client: "codex",
      goal: "创建一个最小 HTML 页面",
      persona: "frontend-builder",
      taskCard: {
        cwd: workspacePath,
        parentTask: "tk1234",
        constraints: ["只改 index.html"],
        acceptance: ["页面可直接打开"],
        verification: ["npm test -- --bail"],
        artifacts: [path.join(workspacePath, "index.html")],
      },
      workspace: workspacePath,
      watch: true,
      timeoutMs: 2000,
    });

    expect(result.task.persona).toBe("frontend-builder");
    expect(result.task.taskCard?.parentTask).toBe("tk1234");
    expect(capturedPrompt).toContain("persona: frontend-builder");
    expect(capturedPrompt).toContain("task_card:");
    expect(capturedPrompt).toContain("parent_task: tk1234");
    expect(capturedPrompt).toContain("只改 index.html");
    expect(capturedPrompt).toContain("npm test -- --bail");
    expect(capturedPrompt).toContain("parent_task_summary:");
    expect(capturedPrompt).toContain("这是父任务的全貌摘要");
    expect(capturedPrompt).toContain("recent_failure_evidence:");
    expect(capturedPrompt).toContain("exit_code: 7");
    expect(capturedPrompt).toContain("Assertion failed");
    expect(capturedPrompt).toContain("Frontend Builder");
  });

  it("status 应基于 pane marker 把 running 任务更新为 completed", async () => {
    sendMessageHandler = async () => ({ success: true });
    const runResult = await runSubagentTask({
      client: "codex",
      goal: "写一个最小 html 页面",
      workspace: workspacePath,
      watch: false,
    });
    capturePaneHandler = async () => `tail\n${runResult.task.doneMarker}`;

    const statusResult = await getSubagentTaskStatus({
      taskId: runResult.task.taskId,
      workspace: workspacePath,
    });

    expect(sendMessageMock).toHaveBeenCalled();
    expect(statusResult.task.status).toBe("completed");
    expect(statusResult.paneTail).toContain(runResult.task.doneMarker);
  });

  it("say --watch 应追加消息真相，并返回本次回复", async () => {
    sendMessageHandler = async () => ({ success: true });
    const runResult = await runSubagentTask({
      client: "codex",
      goal: "继续完善页面",
      workspace: workspacePath,
      watch: false,
    });

    handleTmuxSendHandler = async (_groupName: string, message: string) => ({
      success: true,
      response: `收到继续指令: ${message}`,
    });
    capturePaneHandler = async () => "still running";

    const result = await sendSubagentMessage({
      taskId: runResult.task.taskId,
      message: "继续把按钮做醒目一点",
      workspace: workspacePath,
      watch: true,
      timeoutMs: 1000,
    });

    expect(handleTmuxSendMock).toHaveBeenCalled();
    expect(result.response).toContain("继续把按钮做醒目一点");
    expect(fs.existsSync(result.messagesFile)).toBe(true);

    const lines = fs.readFileSync(result.messagesFile, "utf8").trim().split("\n").map((line) => JSON.parse(line)) as Array<{
      direction: string;
      body: string;
    }>;
    expect(lines[0]?.direction).toBe("to-subagent");
    expect(lines[0]?.body).toContain("继续把按钮做醒目一点");
    expect(lines[1]?.direction).toBe("from-subagent");
    expect(lines[1]?.body).toContain("收到继续指令");
  });

  it("list 应返回当前 workspace 下任务，并支持 client 过滤", async () => {
    await runSubagentTask({
      client: "codex",
      goal: "创建一个最小 html 页面",
      workspace: workspacePath,
      watch: false,
    });
    await runSubagentTask({
      client: "claude-code",
      goal: "整理一个简短报告",
      workspace: workspacePath,
      watch: false,
    });

    const all = await listSubagentTasks({ workspace: workspacePath });
    const codexOnly = await listSubagentTasks({ workspace: workspacePath, client: "codex" });

    expect(all.workspacePath).toBe(workspacePath);
    expect(all.tasks.length).toBe(2);
    expect(codexOnly.tasks.length).toBe(1);
    expect(codexOnly.tasks[0]?.client).toBe("codex");
  });

  it("stop 应发送 ESC 并把任务标记为 stopped", async () => {
    const runResult = await runSubagentTask({
      client: "claude-code",
      goal: "整理一个简短报告",
      workspace: workspacePath,
      watch: false,
    });
    capturePaneHandler = async () => "tail after stop";

    const stopResult = await stopSubagentTask({
      taskId: runResult.task.taskId,
      workspace: workspacePath,
    });

    expect(sendEscapeMock).toHaveBeenCalled();
    expect(stopResult.task.status).toBe("stopped");
    expect(stopResult.task.stoppedAt).toBeDefined();
  });
});
