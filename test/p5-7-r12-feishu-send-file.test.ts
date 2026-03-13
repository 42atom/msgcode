/**
 * msgcode: Feishu Send File 回归锁
 *
 * 目标：
 * - 当前会话上下文写入 workspace config
 * - 文件发送失败时不得伪装成功
 * - chatId 缺省时可从 workspace 当前会话上下文回填
 */

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { executeTool } from "../src/tools/bus.js";
import { loadWorkspaceConfig, saveCurrentSessionContext } from "../src/config/workspace.js";
import { feishuSendFile } from "../src/tools/feishu-send.js";

describe("P5.7-R12: feishu_send_file", () => {
  let workspacePath = "";
  let tempFile = "";
  let tempImage = "";
  const originalAppId = process.env.FEISHU_APP_ID;
  const originalAppSecret = process.env.FEISHU_APP_SECRET;

  beforeEach(() => {
    workspacePath = join(tmpdir(), `msgcode-feishu-${randomUUID()}`);
    mkdirSync(join(workspacePath, ".msgcode"), { recursive: true });

    writeFileSync(
      join(workspacePath, ".msgcode", "config.json"),
      JSON.stringify({
        "tooling.mode": "autonomous",
        "tooling.allow": ["feishu_send_file"],
        "tooling.require_confirm": [],
        "feishu.appId": "workspace-app-id",
        "feishu.appSecret": "workspace-app-secret",
      }),
      "utf-8"
    );

    tempFile = join(workspacePath, "report.txt");
    writeFileSync(tempFile, "hello feishu", "utf-8");
    tempImage = join(workspacePath, "test-cat.png");
    writeFileSync(tempImage, "fake-png-binary", "utf-8");

    delete process.env.FEISHU_APP_ID;
    delete process.env.FEISHU_APP_SECRET;
  });

  afterEach(() => {
    mock.restore();
    if (originalAppId === undefined) {
      delete process.env.FEISHU_APP_ID;
    } else {
      process.env.FEISHU_APP_ID = originalAppId;
    }
    if (originalAppSecret === undefined) {
      delete process.env.FEISHU_APP_SECRET;
    } else {
      process.env.FEISHU_APP_SECRET = originalAppSecret;
    }

    if (workspacePath && existsSync(workspacePath)) {
      rmSync(workspacePath, { recursive: true, force: true });
    }
  });

  it("应将当前会话上下文写入 workspace config", async () => {
    await saveCurrentSessionContext(workspacePath, {
      transport: "feishu",
      chatId: "oc_runtime_chat",
      chatGuid: "feishu:oc_runtime_chat",
    });

    const config = await loadWorkspaceConfig(workspacePath);
    expect(config["runtime.current_transport"]).toBe("feishu");
    expect(config["runtime.current_chat_id"]).toBe("oc_runtime_chat");
    expect(config["runtime.current_chat_guid"]).toBe("feishu:oc_runtime_chat");
  });

  it("文件上传失败降级为文本时，工具结果必须失败", async () => {
    const result = await feishuSendFile(
      {
        filePath: tempFile,
        chatId: "oc_runtime_chat",
        message: "请查收",
      },
      {
        appId: "app-id",
        appSecret: "app-secret",
        createTransport: () => ({
          send: async () => ({
            ok: true,
            error: "HTTP 400 code=99991663 invalid file_type",
          }),
        }),
      }
    );

    expect(result.ok).toBe(false);
    expect(result.chatId).toBe("oc_runtime_chat");
    expect(result.error).toContain("invalid file_type");
  });

  it("文件真正发送成功时，应返回附件结果", async () => {
    const result = await feishuSendFile(
      {
        filePath: tempFile,
        chatId: "oc_runtime_chat",
      },
      {
        appId: "app-id",
        appSecret: "app-secret",
        createTransport: () => ({
          send: async () => ({
            ok: true,
            attachmentType: "file",
            attachmentKey: "file_v3_123",
          }),
        }),
      }
    );

    expect(result.ok).toBe(true);
    expect(result.chatId).toBe("oc_runtime_chat");
    expect(result.attachmentType).toBe("file");
    expect(result.attachmentKey).toBe("file_v3_123");
  });

  it("图片发送成功时，也应视为成功", async () => {
    const result = await feishuSendFile(
      {
        filePath: tempImage,
        chatId: "oc_runtime_chat",
      },
      {
        appId: "app-id",
        appSecret: "app-secret",
        createTransport: () => ({
          send: async () => ({
            ok: true,
            attachmentType: "image",
            attachmentKey: "img_v3_123",
          }),
        }),
      }
    );

    expect(result.ok).toBe(true);
    expect(result.chatId).toBe("oc_runtime_chat");
  });

  it("chatId 缺省时应从 workspace 当前会话上下文回填", async () => {
    await saveCurrentSessionContext(workspacePath, {
      transport: "feishu",
      chatId: "oc_from_workspace",
      chatGuid: "feishu:oc_from_workspace",
    });

    mock.module("../src/tools/feishu-send.js", () => ({
      feishuSendFile: async (args: { filePath: string; chatId: string; message?: string }) => ({
        ok: true,
        chatId: args.chatId,
        attachmentType: "file",
        attachmentKey: "file_v3_workspace",
      }),
    }));

    const result = await executeTool(
      "feishu_send_file",
      { filePath: tempFile },
      {
        workspacePath,
        source: "llm-tool-call",
        requestId: randomUUID(),
      }
    );

    expect(result.ok).toBe(true);
    expect(result.data?.chatId).toBe("oc_from_workspace");
    expect(result.data?.attachmentType).toBe("file");
    expect(result.data?.attachmentKey).toBe("file_v3_workspace");
    expect(result.previewText).toContain("[feishu_send_file]");
    expect(result.previewText).toContain("[attachmentType] file");
    expect(result.previewText).toContain("[attachmentKey] file_v3_workspace");
  });

});
