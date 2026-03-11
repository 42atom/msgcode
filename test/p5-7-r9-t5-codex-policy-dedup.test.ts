import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanupDir(target: string): void {
  if (!target) return;
  fs.rmSync(target, { recursive: true, force: true });
}

async function createFakeCodexBin(root: string): Promise<string> {
  const binDir = path.join(root, "bin");
  fs.mkdirSync(binDir, { recursive: true });
  const scriptPath = path.join(binDir, "codex");
  fs.writeFileSync(
    scriptPath,
    [
      "#!/bin/sh",
      "out=\"\"",
      "while [ \"$#\" -gt 0 ]; do",
      "  if [ \"$1\" = \"--output-last-message\" ]; then",
      "    shift",
      "    out=\"$1\"",
      "  fi",
      "  shift",
      "done",
      "printf 'Codex 已执行' > \"$out\"",
      "exit 0",
    ].join("\n"),
    "utf-8",
  );
  fs.chmodSync(scriptPath, 0o755);
  return binDir;
}

describe("P5.7-R9-T5: tmux 策略守卫行为锁", () => {
  let tmpDir = "";
  let workspacePath = "";
  let originalPath = "";

  beforeEach(() => {
    tmpDir = createTempDir("msgcode-r9-t5-");
    workspacePath = path.join(tmpDir, "workspace");
    fs.mkdirSync(workspacePath, { recursive: true });
    originalPath = process.env.PATH || "";
  });

  afterEach(() => {
    process.env.PATH = originalPath;
    cleanupDir(tmpDir);
  });

  it("tmux + local-only 应返回拒绝结果", async () => {
    const { setRuntimeKind, setPolicyMode } = await import("../src/config/workspace.js");
    const { CodexHandler } = await import("../src/handlers.js");

    await setRuntimeKind(workspacePath, "tmux");
    await setPolicyMode(workspacePath, "local-only");

    const handler = new CodexHandler();
    const result = await handler.handle("帮我执行一下", {
      botType: "agent-backend",
      chatId: "chat-r9-t5-block",
      groupName: "codex-block",
      projectDir: workspacePath,
      originalMessage: {
        id: "msg-r9-t5-block",
        chatId: "chat-r9-t5-block",
        text: "帮我执行一下",
        isFromMe: false,
        sender: "tester@example.com",
        handle: "tester@example.com",
      },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("local-only");
    expect(result.error).toContain("/policy on");
  });

  it("非 tmux 运行形态不应被拒绝，并应真实调用 codex exec", async () => {
    const fakeBinDir = await createFakeCodexBin(tmpDir);
    process.env.PATH = `${fakeBinDir}:${originalPath}`;

    const { setRuntimeKind, setPolicyMode } = await import("../src/config/workspace.js");
    const { CodexHandler } = await import("../src/handlers.js");

    await setRuntimeKind(workspacePath, "agent");
    await setPolicyMode(workspacePath, "local-only");

    const handler = new CodexHandler();
    const result = await handler.handle("帮我执行一下", {
      botType: "agent-backend",
      chatId: "chat-r9-t5-pass",
      groupName: "codex-pass",
      projectDir: workspacePath,
      originalMessage: {
        id: "msg-r9-t5-pass",
        chatId: "chat-r9-t5-pass",
        text: "帮我执行一下",
        isFromMe: false,
        sender: "tester@example.com",
        handle: "tester@example.com",
      },
    });

    expect(result.success).toBe(true);
    expect(result.response).toBe("Codex 已执行");
  });
});
