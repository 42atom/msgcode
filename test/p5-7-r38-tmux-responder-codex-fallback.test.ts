import { beforeEach, describe, expect, it, mock } from "bun:test";

let capturePaneQueue: string[] = [];
const capturePaneMock = mock(async () => capturePaneQueue.shift() ?? "");
const sendTextLiteralMock = mock(async () => undefined);
const sendEnterMock = mock(async () => undefined);
const isTextStillInInputMock = mock(async () => false);
const sendMessageMock = mock(async () => ({ success: true }));
const sendEscapeMock = mock(async () => "已发送 ESC 中断");
const existsMock = mock(async () => true);
const getRunnerStatusMock = mock(async () => "ready");

mock.module("../src/tmux/session.js", () => ({
  SessionStatus: {
    Ready: "ready",
    Starting: "starting",
    Stopped: "stopped",
  },
  TmuxSession: {
    getSessionName: (_groupName: string) => "msgcode-test-group",
    exists: existsMock,
    getRunnerStatus: getRunnerStatusMock,
    capturePane: capturePaneMock,
    sendTextLiteral: sendTextLiteralMock,
    sendEnter: sendEnterMock,
    isTextStillInInput: isTextStillInInputMock,
  },
}));

mock.module("../src/output/codex-reader.js", () => ({
  CodexOutputReader: class {
    async findLatestJsonlForWorkspace(): Promise<string | null> {
      return null;
    }
    async seekToEnd(): Promise<number> {
      return 0;
    }
    async read(): Promise<{ entries: []; bytesRead: number; newOffset: number }> {
      return { entries: [], bytesRead: 0, newOffset: 0 };
    }
  },
}));

mock.module("../src/tmux/sender.js", () => ({
  sendAttachmentsToSession: async () => undefined,
  sendMessage: sendMessageMock,
  sendEscape: sendEscapeMock,
}));

const { handleTmuxSend } = await import(`../src/tmux/responder.js?case=r38-${Date.now()}`);

describe("P5.7-R38: tmux responder codex fallback", () => {
  beforeEach(() => {
    capturePaneQueue = [];
    capturePaneMock.mockClear();
    sendTextLiteralMock.mockClear();
    sendEnterMock.mockClear();
    isTextStillInInputMock.mockClear();
    sendMessageMock.mockClear();
    sendEscapeMock.mockClear();
    existsMock.mockClear();
    getRunnerStatusMock.mockClear();
  });

  it("codex 缺少 JSONL 时应 fallback 到 pane，并在看到 done marker 时立即返回", async () => {
    const marker = "MSGCODE_SUBAGENT_DONE 11111111-2222-3333-4444-555555555555";
    capturePaneQueue = [
      "baseline prompt",
      `任务执行中\n${marker}\n› prompt`,
      `任务执行中\n${marker}\n› prompt`,
    ];

    const result = await handleTmuxSend(
      "test-group",
      `goal\n- 成功完成后，最后单独输出一行：${marker}`,
      {
        projectDir: "/tmp/fake-workspace",
        runnerType: "tmux",
        runnerOld: "codex",
        timeout: 1000,
        fastInterval: 1,
        slowInterval: 1,
      }
    );

    expect(result.success).toBe(true);
    expect(result.response).toContain(marker);
    expect(sendTextLiteralMock).toHaveBeenCalled();
    expect(sendEnterMock).toHaveBeenCalled();
  });
});
