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
  getSubagentTaskStatus,
  stopSubagentTask,
} = await import("../src/runtime/subagent.js");

describe("P5.7-R37: subagent runtime", () => {
  let workspacePath = "";

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

  it("run --watch 应落 task 文件并在成功后标记 completed", async () => {
    handleTmuxSendHandler = async (_groupName: string, prompt: string) => ({
      success: true,
      response: `处理中\n${prompt.includes("MSGCODE_SUBAGENT_DONE") ? prompt.match(/MSGCODE_SUBAGENT_DONE\\s+([\\w-]+)/)?.[0] ?? "" : ""}`,
    });
    capturePaneHandler = async () => "pane tail\nMSGCODE_SUBAGENT_DONE task-from-pane";

    const result = await runSubagentTask({
      client: "codex",
      goal: "创建一个贪吃蛇 HTML 游戏",
      workspace: workspacePath,
      watch: true,
      timeoutMs: 1000,
    });

    expect(startMock).toHaveBeenCalled();
    expect(handleTmuxSendMock).toHaveBeenCalled();
    expect(result.task.status).toBe("completed");
    expect(fs.existsSync(result.task.taskFile)).toBe(true);
    const saved = JSON.parse(fs.readFileSync(result.task.taskFile, "utf8")) as { status: string; goal: string };
    expect(saved.status).toBe("completed");
    expect(saved.goal).toContain("贪吃蛇");
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
