import { describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";

const projectRoot = "/Users/admin/GitProjects/msgcode";
const mainHtmlPath = path.join(projectRoot, "ui-protype", "main.html");
const mainJsPath = path.join(projectRoot, "ui-protype", "main.js");

describe("readonly thread surface slice", () => {
  it("主窗口应收口为只读 thread surface", async () => {
    const [mainHtml, mainJs] = await Promise.all([
      fs.readFile(mainHtmlPath, "utf8"),
      fs.readFile(mainJsPath, "utf8"),
    ]);

    expect(mainHtml).toContain('id="workspace-tree"');
    expect(mainHtml).toContain('id="chat-log"');
    expect(mainHtml).toContain('id="observer-secondary-content"');
    expect(mainHtml).toContain('href="./settings.html"');
    expect(mainHtml).not.toContain("archive.html");
    expect(mainHtml).not.toContain('id="new-chat-button"');
    expect(mainHtml).not.toContain('id="send-button"');
    expect(mainHtml).not.toContain('class="composer"');

    expect(mainJs).toContain("selectedWorkspace");
    expect(mainJs).toContain("selectedThreadId");
    expect(mainJs).toContain("loadingError");
    expect(mainJs).toContain('runSurfaceCommand("workspace-tree"');
    expect(mainJs).toContain('runSurfaceCommand("thread"');
    expect(mainJs).toContain("window.msgcodeReadonlySurface.runCommand");

    for (const retiredToken of [
      "pendingDraftContext",
      "workspaceTreeData",
      "threadSurfaceData",
      "WORKSPACE_ORDER_STORAGE_KEY",
      "newChatButton",
      "sendButton",
      "composerInput",
      "renderComposerSurface",
      "applyStoredWorkspaceOrder",
      "bindWorkspaceSorting",
    ]) {
      expect(mainJs).not.toContain(retiredToken);
    }
  });
});
