/**
 * msgcode: P5.7-R13 browser bootstrap 回归锁
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureChromeRoot, getChromeRootInfo } from "../src/browser/chrome-root.js";

describe("P5.7-R13: browser bootstrap", () => {
  const originalWorkspaceRoot = process.env.WORKSPACE_ROOT;
  let tempWorkspaceRoot = "";

  beforeEach(async () => {
    tempWorkspaceRoot = await mkdtemp(join(tmpdir(), "msgcode-browser-bootstrap-"));
    process.env.WORKSPACE_ROOT = tempWorkspaceRoot;
  });

  afterEach(async () => {
    if (originalWorkspaceRoot === undefined) {
      delete process.env.WORKSPACE_ROOT;
    } else {
      process.env.WORKSPACE_ROOT = originalWorkspaceRoot;
    }

    if (tempWorkspaceRoot) {
      await rm(tempWorkspaceRoot, { recursive: true, force: true });
    }
  });

  it("应初始化共享工作 Chrome 根目录并保持 launchCommand 合同", async () => {
    const info = await ensureChromeRoot({
      name: "work-default",
      port: 9222,
    });

    expect(info.chromeRoot).toBe(join(tempWorkspaceRoot, ".msgcode", "chrome-profiles", "work-default"));
    expect(info.launchCommand).toContain("--remote-debugging-port=9222");
    expect(info.launchCommand).toContain(info.chromeRoot);
  });

  it("getChromeRootInfo 不应暴露 PinchTab runtime 字段", async () => {
    const info = getChromeRootInfo({
      name: "work-default",
      port: 9333,
    }) as Record<string, unknown>;

    expect(info.chromeRoot).toBe(join(tempWorkspaceRoot, ".msgcode", "chrome-profiles", "work-default"));
    expect(info.launchCommand).toContain("--remote-debugging-port=9333");
    expect(info.baseUrl).toBeUndefined();
    expect(info.binaryPath).toBeUndefined();
  });
});
