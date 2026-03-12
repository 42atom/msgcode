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
