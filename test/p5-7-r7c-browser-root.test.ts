/**
 * msgcode: P5.7-R7C Chrome 工作根目录回归锁
 */

import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  CHROME_ROOT_ERROR_CODES,
  ChromeRootCommandError,
  ensureChromeRoot,
  getChromeProfilesRoot,
  getChromeRootInfo,
} from "../src/browser/chrome-root.js";

describe("P5.7-R7C: browser root", () => {
  const originalWorkspaceRoot = process.env.WORKSPACE_ROOT;
  const originalProfilesRoot = process.env.MSGCODE_CHROME_PROFILES_ROOT;
  let tempWorkspaceRoot = "";

  afterEach(() => {
    if (originalWorkspaceRoot === undefined) {
      delete process.env.WORKSPACE_ROOT;
    } else {
      process.env.WORKSPACE_ROOT = originalWorkspaceRoot;
    }

    if (originalProfilesRoot === undefined) {
      delete process.env.MSGCODE_CHROME_PROFILES_ROOT;
    } else {
      process.env.MSGCODE_CHROME_PROFILES_ROOT = originalProfilesRoot;
    }

    if (tempWorkspaceRoot && existsSync(tempWorkspaceRoot)) {
      rmSync(tempWorkspaceRoot, { recursive: true, force: true });
    }
    tempWorkspaceRoot = "";
  });

  it("默认路径应落在 WORKSPACE_ROOT/.msgcode/chrome-profiles/<name>", () => {
    tempWorkspaceRoot = join(tmpdir(), `msgcode-browser-root-${randomUUID()}`);
    process.env.WORKSPACE_ROOT = tempWorkspaceRoot;
    delete process.env.MSGCODE_CHROME_PROFILES_ROOT;

    const profilesRoot = getChromeProfilesRoot();
    const info = getChromeRootInfo();

    expect(profilesRoot).toBe(join(tempWorkspaceRoot, ".msgcode", "chrome-profiles"));
    expect(info.chromeRoot).toBe(join(tempWorkspaceRoot, ".msgcode", "chrome-profiles", "work-default"));
    expect(info.exists).toBe(false);
    expect(info.launchCommand).toContain(join(tempWorkspaceRoot, ".msgcode", "chrome-profiles", "work-default"));
  });

  it("--ensure 应创建 chromeRoot 目录", async () => {
    tempWorkspaceRoot = join(tmpdir(), `msgcode-browser-root-${randomUUID()}`);
    process.env.WORKSPACE_ROOT = tempWorkspaceRoot;
    delete process.env.MSGCODE_CHROME_PROFILES_ROOT;

    const info = await ensureChromeRoot({ name: "social", port: 9333 });

    expect(info.chromeRoot).toBe(join(tempWorkspaceRoot, ".msgcode", "chrome-profiles", "social"));
    expect(info.exists).toBe(true);
    expect(existsSync(info.chromeRoot)).toBe(true);
    expect(info.remoteDebuggingPort).toBe(9333);
  });

  it("非法 root name 应返回 BROWSER_BAD_ARGS", () => {
    expect(() => getChromeRootInfo({ name: "../default" })).toThrowError(ChromeRootCommandError);

    try {
      getChromeRootInfo({ name: "../default" });
    } catch (error) {
      const typed = error as ChromeRootCommandError;
      expect(typed.code).toBe(CHROME_ROOT_ERROR_CODES.BAD_ARGS);
    }
  });
});
