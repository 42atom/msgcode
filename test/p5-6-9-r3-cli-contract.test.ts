/**
 * msgcode: P5.6.9-R3 CLI 契约回归测试
 *
 * 验证 Envelope 结构、错误码、JSON+Text 输出一致性
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createEnvelope, getWorkspacePath } from "../src/cli/command-runner.js";
import type { Diagnostic } from "../src/memory/types.js";

// ============================================
// Envelope 契约测试
// ============================================

describe("P5.6.9-R3: CLI 契约 - Envelope 结构", () => {
  it("R3-1: Envelope 包含所有必要字段", () => {
    const startTime = Date.now();
    const warnings: Diagnostic[] = [];
    const errors: Diagnostic[] = [];

    const envelope = createEnvelope("test command", startTime, "pass", { foo: "bar" }, warnings, errors);

    // 验证必要字段
    expect(envelope).toHaveProperty("schemaVersion");
    expect(envelope).toHaveProperty("command");
    expect(envelope).toHaveProperty("requestId");
    expect(envelope).toHaveProperty("timestamp");
    expect(envelope).toHaveProperty("durationMs");
    expect(envelope).toHaveProperty("status");
    expect(envelope).toHaveProperty("exitCode");
    expect(envelope).toHaveProperty("summary");
    expect(envelope).toHaveProperty("data");
    expect(envelope).toHaveProperty("warnings");
    expect(envelope).toHaveProperty("errors");
  });

  it("R3-2: schemaVersion 固定为 2", () => {
    const envelope = createEnvelope("test", Date.now(), "pass", {});
    expect(envelope.schemaVersion).toBe(2);
  });

  it("R3-3: status 与 exitCode 映射关系", () => {
    const passEnvelope = createEnvelope("test", Date.now(), "pass", {});
    expect(passEnvelope.status).toBe("pass");
    expect(passEnvelope.exitCode).toBe(0);

    const warningEnvelope = createEnvelope("test", Date.now(), "warning", {});
    expect(warningEnvelope.status).toBe("warning");
    expect(warningEnvelope.exitCode).toBe(2);

    const errorEnvelope = createEnvelope("test", Date.now(), "error", {});
    expect(errorEnvelope.status).toBe("error");
    expect(errorEnvelope.exitCode).toBe(1);
  });

  it("R3-4: summary 统计 warnings 和 errors", () => {
    const warnings: Diagnostic[] = [
      { code: "WARN_1", message: "Warning 1" },
      { code: "WARN_2", message: "Warning 2" },
    ];
    const errors: Diagnostic[] = [
      { code: "ERR_1", message: "Error 1" },
    ];

    const envelope = createEnvelope("test", Date.now(), "error", {}, warnings, errors);

    expect(envelope.summary.warnings).toBe(2);
    expect(envelope.summary.errors).toBe(1);
  });

  it("R3-5: requestId 是有效的 UUID", () => {
    const envelope = createEnvelope("test", Date.now(), "pass", {});

    // UUID 格式：xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(envelope.requestId).toMatch(uuidPattern);
  });

  it("R3-6: timestamp 是 ISO 8601 格式", () => {
    const envelope = createEnvelope("test", Date.now(), "pass", {});

    // ISO 8601 格式：YYYY-MM-DDTHH:mm:ss.sssZ
    const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
    expect(envelope.timestamp).toMatch(isoPattern);
  });

  it("R3-7: durationMs 是非负数", () => {
    const startTime = Date.now() - 100; // 100ms 前
    const envelope = createEnvelope("test", startTime, "pass", {});

    expect(envelope.durationMs).toBeGreaterThanOrEqual(0);
    expect(envelope.durationMs).toBeGreaterThanOrEqual(100);
  });

  it("R3-8: data 保留原始数据结构", () => {
    const data = {
      id: "123",
      name: "test",
      nested: {
        foo: "bar",
        array: [1, 2, 3],
      },
    };

    const envelope = createEnvelope("test", Date.now(), "pass", data);

    expect(envelope.data).toEqual(data);
    expect(envelope.data.id).toBe("123");
    expect(envelope.data.nested.array).toEqual([1, 2, 3]);
  });
});

// ============================================
// 工作区路径解析测试
// ============================================

describe("P5.6.9-R3: CLI 契约 - 工作区路径", () => {
  // P5.6.13-R1a: 环境隔离 - 保存/恢复 WORKSPACE_ROOT
  let originalWorkspaceRoot: string | undefined;

  beforeEach(() => {
    originalWorkspaceRoot = process.env.WORKSPACE_ROOT;
    delete process.env.WORKSPACE_ROOT;
  });

  afterEach(() => {
    if (originalWorkspaceRoot !== undefined) {
      process.env.WORKSPACE_ROOT = originalWorkspaceRoot;
    } else {
      delete process.env.WORKSPACE_ROOT;
    }
  });

  it("R3-9: 空标签返回默认工作区根目录", () => {
    const path = getWorkspacePath("");
    expect(path).toContain("msgcode-workspaces");
  });

  it("R3-10: ~ 扩展为 HOME 目录", () => {
    const path = getWorkspacePath("~");
    expect(path).toBe(process.env.HOME);
  });

  it("R3-11: ~/path 扩展为 HOME/path", () => {
    const path = getWorkspacePath("~/myproject");
    expect(path).toContain(process.env.HOME || "");
    expect(path).toContain("myproject");
  });

  it("R3-12: 绝对路径保持不变", () => {
    const absPath = "/Users/test/workspace";
    const path = getWorkspacePath(absPath);
    expect(path).toBe(absPath);
  });

  it("R3-13: 相对路径解析为 WORKSPACE_ROOT/label", () => {
    const path = getWorkspacePath("myproject");
    expect(path).toContain("msgcode-workspaces");
    expect(path).toContain("myproject");
  });
});

// ============================================
// Envelope 边界条件测试
// ============================================

describe("P5.6.9-R3: CLI 契约 - 边界条件", () => {
  it("R3-14: 空数据对象", () => {
    const envelope = createEnvelope("test", Date.now(), "pass", {});
    expect(envelope.data).toEqual({});
  });

  it("R3-15: null 数据", () => {
    const envelope = createEnvelope("test", Date.now(), "error", null);
    expect(envelope.data).toBeNull();
  });

  it("R3-16: 大型数据对象", () => {
    const largeData = {
      items: Array.from({ length: 1000 }, (_, i) => ({ id: i, value: `item-${i}` })),
    };

    const envelope = createEnvelope("test", Date.now(), "pass", largeData);

    expect(envelope.data.items.length).toBe(1000);
    expect(envelope.data.items[0]).toEqual({ id: 0, value: "item-0" });
  });

  it("R3-17: 包含特殊字符的命令", () => {
    const command = 'msgcode run asr --workspace "my workspace" --input "test file.m4a"';
    const envelope = createEnvelope(command, Date.now(), "pass", {});

    expect(envelope.command).toBe(command);
  });
});

// ============================================
// Diagnostic 结构测试
// ============================================

describe("P5.6.9-R3: CLI 契约 - Diagnostic", () => {
  it("R3-18: Diagnostic 必要字段", () => {
    const diagnostic: Diagnostic = {
      code: "TEST_ERROR",
      message: "Test error message",
    };

    expect(diagnostic).toHaveProperty("code");
    expect(diagnostic).toHaveProperty("message");
  });

  it("R3-19: Diagnostic 可选字段", () => {
    const diagnostic: Diagnostic = {
      code: "TEST_ERROR",
      message: "Test error message",
      hint: "Try this hint",
      details: { key: "value" },
    };

    expect(diagnostic.hint).toBe("Try this hint");
    expect(diagnostic.details).toEqual({ key: "value" });
  });
});
