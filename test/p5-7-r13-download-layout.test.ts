import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { copyToVault } from "../src/attachments/vault.js";

describe("P5.7-R13: downloads layout", () => {
  const tempPaths: string[] = [];

  afterEach(() => {
    for (const target of tempPaths.splice(0)) {
      if (existsSync(target)) {
        rmSync(target, { recursive: true, force: true });
      }
    }
  });

  it("音频附件应落到 downloads/audio", async () => {
    const workspacePath = join(tmpdir(), `msgcode-workspace-${randomUUID()}`);
    const sourceDir = join(tmpdir(), `msgcode-source-${randomUUID()}`);
    tempPaths.push(workspacePath, sourceDir);
    mkdirSync(workspacePath, { recursive: true });
    mkdirSync(sourceDir, { recursive: true });

    const sourcePath = join(sourceDir, "voice.opus");
    writeFileSync(sourcePath, "fake-audio");

    const result = await copyToVault(workspacePath, "msg_audio", {
      path: sourcePath,
      filename: "voice.opus",
      mime: "audio/opus",
    });

    expect(result.success).toBe(true);
    expect(result.localPath).toContain("/downloads/audio/");
  });

  it("普通文件应落到 downloads/files", async () => {
    const workspacePath = join(tmpdir(), `msgcode-workspace-${randomUUID()}`);
    const sourceDir = join(tmpdir(), `msgcode-source-${randomUUID()}`);
    tempPaths.push(workspacePath, sourceDir);
    mkdirSync(workspacePath, { recursive: true });
    mkdirSync(sourceDir, { recursive: true });

    const sourcePath = join(sourceDir, "report.html");
    writeFileSync(sourcePath, "<html>ok</html>");

    const result = await copyToVault(workspacePath, "msg_file", {
      path: sourcePath,
      filename: "report.html",
      mime: "text/html",
    });

    expect(result.success).toBe(true);
    expect(result.localPath).toContain("/downloads/files/");
  });

  it("历史 .caf 语音在没有 mime 时也应落到 downloads/audio", async () => {
    const workspacePath = join(tmpdir(), `msgcode-workspace-${randomUUID()}`);
    const sourceDir = join(tmpdir(), `msgcode-source-${randomUUID()}`);
    tempPaths.push(workspacePath, sourceDir);
    mkdirSync(workspacePath, { recursive: true });
    mkdirSync(sourceDir, { recursive: true });

    const sourcePath = join(sourceDir, "Audio_Message.caf");
    writeFileSync(sourcePath, "fake-caf");

    const result = await copyToVault(workspacePath, "msg_caf", {
      path: sourcePath,
      filename: "Audio_Message.caf",
    });

    expect(result.success).toBe(true);
    expect(result.localPath).toContain("/downloads/audio/");
  });
});
