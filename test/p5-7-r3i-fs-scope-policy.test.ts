/**
 * msgcode: P5.7-R3i 文件权限策略分层回归锁测试
 *
 * 目标：
 * - workspace 模式越界拒绝
 * - unrestricted 模式越界放行
 * - 作用域配置读写与默认值稳定
 */

import { describe, it, expect } from "bun:test";
import { mkdtemp, writeFile, rm, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeTool } from "../src/tools/bus.js";
import {
  DEFAULT_WORKSPACE_CONFIG,
  getFsScope,
  setFsScope,
  setToolingAllow,
} from "../src/config/workspace.js";

describe("P5.7-R3i: File Scope Policy", () => {
  it("默认工作区配置应保持 unrestricted", () => {
    expect(DEFAULT_WORKSPACE_CONFIG["tooling.fs_scope"]).toBe("unrestricted");
  });

  it("getFsScope / setFsScope 应读写真实配置", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "r3i-config-"));

    try {
      expect(await getFsScope(workspacePath)).toBe("unrestricted");
      await setFsScope(workspacePath, "workspace");
      expect(await getFsScope(workspacePath)).toBe("workspace");
      await setFsScope(workspacePath, "unrestricted");
      expect(await getFsScope(workspacePath)).toBe("unrestricted");
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  it("workspace 模式应拒绝 read_file 越界绝对路径", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "r3i-ws-read-"));
    const outsideDir = await mkdtemp(join(tmpdir(), "r3i-outside-read-"));
    const outsideFile = join(outsideDir, "outside.txt");
    await writeFile(outsideFile, "outside-content", "utf-8");

    try {
      await setFsScope(workspacePath, "workspace");
      const result = await executeTool("read_file", { path: outsideFile }, {
        workspacePath,
        source: "slash-command",
        requestId: "r3i-read-deny",
      });

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("TOOL_NOT_ALLOWED");
      expect(result.error?.message).toContain("path must be under workspace");
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("workspace 模式应拒绝 write_file / edit_file 越界绝对路径", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "r3i-ws-write-edit-"));
    const outsideDir = await mkdtemp(join(tmpdir(), "r3i-outside-write-edit-"));
    const outsideFile = join(outsideDir, "outside.txt");
    await writeFile(outsideFile, "alpha", "utf-8");

    try {
      await setFsScope(workspacePath, "workspace");
      await setToolingAllow(workspacePath, ["write_file", "edit_file"]);

      const writeResult = await executeTool("write_file", {
        path: outsideFile,
        content: "blocked",
      }, {
        workspacePath,
        source: "slash-command",
        requestId: "r3i-write-deny",
      });

      const editResult = await executeTool("edit_file", {
        path: outsideFile,
        oldText: "alpha",
        newText: "beta",
      }, {
        workspacePath,
        source: "slash-command",
        requestId: "r3i-edit-deny",
      });

      expect(writeResult.ok).toBe(false);
      expect(editResult.ok).toBe(false);
      expect(writeResult.error?.code).toBe("TOOL_NOT_ALLOWED");
      expect(editResult.error?.code).toBe("TOOL_NOT_ALLOWED");
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("unrestricted 模式应允许 read_file 读取越界绝对路径", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "r3i-ws-read-open-"));
    const outsideDir = await mkdtemp(join(tmpdir(), "r3i-outside-read-open-"));
    const outsideFile = join(outsideDir, "outside.txt");
    await writeFile(outsideFile, "outside-content", "utf-8");

    try {
      await setFsScope(workspacePath, "unrestricted");
      const result = await executeTool("read_file", { path: outsideFile }, {
        workspacePath,
        source: "slash-command",
        requestId: "r3i-read-allow",
      });

      expect(result.ok).toBe(true);
      expect(result.data?.content).toBe("outside-content");
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("workspace 模式不应把前缀碰撞路径误判为工作区内", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "r3i-prefix-ws-"));
    const outsideDir = `${workspacePath}-evil`;
    await mkdir(outsideDir, { recursive: true });
    const outsideFile = join(outsideDir, "outside.txt");
    await writeFile(outsideFile, "evil", "utf-8");

    try {
      await setFsScope(workspacePath, "workspace");
      const result = await executeTool("read_file", { path: outsideFile }, {
        workspacePath,
        source: "slash-command",
        requestId: "r3i-prefix-collision",
      });

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("TOOL_NOT_ALLOWED");
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("workspace 模式应允许 workspace 内相对路径写入", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "r3i-ws-write-inside-"));
    const targetPath = join(workspacePath, "nested", "file.txt");

    try {
      await setFsScope(workspacePath, "workspace");
      await setToolingAllow(workspacePath, ["write_file"]);
      const writeResult = await executeTool("write_file", {
        path: "nested/file.txt",
        content: "inside",
      }, {
        workspacePath,
        source: "slash-command",
        requestId: "r3i-write-inside",
      });

      expect(writeResult.ok).toBe(true);
      expect(await readFile(targetPath, "utf-8")).toBe("inside");
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });
});
