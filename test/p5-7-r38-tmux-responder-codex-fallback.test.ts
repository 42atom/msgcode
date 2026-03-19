import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { __resetResponderTestDeps, __setResponderTestDeps, handleTmuxSend } from "../src/tmux/responder.js";

let capturePaneQueue: string[] = [];
const capturePaneMock = mock(async () => capturePaneQueue.shift() ?? "");
const sendTextLiteralMock = mock(async () => undefined);
const sendEnterMock = mock(async () => undefined);
const isTextStillInInputMock = mock(async () => false);
const sendMessageMock = mock(async () => ({ success: true }));
const sendEscapeMock = mock(async () => "已发送 ESC 中断");
const existsMock = mock(async () => true);
const getRunnerStatusMock = mock(async () => "ready");

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
    __resetResponderTestDeps();
    __setResponderTestDeps({
      sessionStatus: {
        Ready: "ready",
        Starting: "starting",
        Stopped: "stopped",
      } as typeof import("../src/tmux/session.js").SessionStatus,
      tmuxSession: {
        getSessionName: (_groupName: string) => "msgcode-test-group",
        exists: existsMock,
        getRunnerStatus: getRunnerStatusMock,
        capturePane: capturePaneMock,
        sendTextLiteral: sendTextLiteralMock,
        sendEnter: sendEnterMock,
        isTextStillInInput: isTextStillInInputMock,
      } as unknown as typeof import("../src/tmux/session.js").TmuxSession,
      createCodexReader: () =>
        ({
          async findLatestJsonlForWorkspace(): Promise<string | null> {
            return null;
          },
          async seekToEnd(): Promise<number> {
            return 0;
          },
          async read(): Promise<{ entries: []; bytesRead: number; newOffset: number }> {
            return { entries: [], bytesRead: 0, newOffset: 0 };
          },
        }) as unknown as import("../src/output/codex-reader.js").CodexOutputReader,
      sendAttachments: async () => undefined,
    });
  });

  afterEach(() => {
    __resetResponderTestDeps();
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
