import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { formatAttachmentForTmux } from "../src/attachments/vault.js";
import { processAttachment } from "../src/media/pipeline.js";

describe("P5.7-R13: attachment routing", () => {
  const cleanupTargets: string[] = [];

  afterEach(() => {
    for (const target of cleanupTargets.splice(0)) {
      if (existsSync(target)) {
        rmSync(target, { recursive: true, force: true });
      }
    }
  });

  it("音频附件应把路径暴露给模型，而不是假定已有转写", () => {
    const payload = formatAttachmentForTmux(
      {
        filename: "voice.opus",
        mime: "audio/opus",
      },
      "/tmp/voice.opus",
      "digest123",
    );

    expect(payload).toContain("[attachment]");
    expect(payload).toContain("type=audio");
    expect(payload).toContain("path=/tmp/voice.opus");
    expect(payload).toContain("digest=digest123");
    expect(payload).not.toContain("audio_transcript_follows");
  });

  it("非图片附件不应再自动生成派生文本", async () => {
    const workspacePath = join(tmpdir(), `msgcode-workspace-${randomUUID()}`);
    const sourceDir = join(tmpdir(), `msgcode-source-${randomUUID()}`);
    cleanupTargets.push(workspacePath, sourceDir);
    mkdirSync(workspacePath, { recursive: true });
    mkdirSync(sourceDir, { recursive: true });

    const audioPath = join(sourceDir, "voice.opus");
    writeFileSync(audioPath, "fake-audio");

    const result = await processAttachment(
      audioPath,
      {
        filename: "voice.opus",
        mime: "audio/opus",
        path: audioPath,
      },
      workspacePath,
    );

    expect(result.derived).toBeUndefined();
  });
});
