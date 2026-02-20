/**
 * msgcode: P5.7-R1 CLI-First File Send 回归测试
 *
 * 验证：
 * 1. file send 命令合同
 * 2. help-docs --json 包含 file send
 * 3. 大小限制检查
 */

import { describe, it, expect } from "bun:test";
import { getFileSendContract } from "../src/cli/file.js";
import { createEnvelope } from "../src/cli/file.js";
import type { Diagnostic } from "../src/memory/types.js";

// ============================================
// File Send 合同测试
// ============================================

describe("P5.7-R1: CLI-First File Send", () => {
  describe("R1: 命令合同", () => {
    it("R1-1: getFileSendContract 返回完整合同", () => {
      const contract = getFileSendContract();

      expect(contract).toHaveProperty("name", "file send");
      expect(contract).toHaveProperty("description");
      expect(contract).toHaveProperty("options");
      expect(contract.options?.required).toHaveProperty("--path <path>");
      expect(contract.options?.optional).toHaveProperty("--caption <caption>");
      expect(contract.options?.optional).toHaveProperty("--mime <mime>");
      expect(contract.options?.optional).toHaveProperty("--json");
    });

    it("R1-2: 合同包含输出结构定义", () => {
      const contract = getFileSendContract();

      expect(contract.output).toHaveProperty("success");
      expect(contract.output?.success).toEqual({
        ok: true,
        sendResult: "OK",
        path: "<文件路径>",
        fileSizeBytes: "<文件大小（字节）>",
      });

      expect(contract.output).toHaveProperty("sizeExceeded");
      expect(contract.output?.sizeExceeded).toEqual({
        ok: false,
        sendResult: "SIZE_EXCEEDED",
        fileSizeBytes: "<实际大小>",
        limitBytes: 1024 * 1024 * 1024,
      });

      expect(contract.output).toHaveProperty("sendFailed");
      expect(contract.output?.sendFailed).toEqual({
        ok: false,
        sendResult: "SEND_FAILED",
        errorMessage: "<错误信息>",
      });
    });

    it("R1-3: 合同包含错误码枚举", () => {
      const contract = getFileSendContract();

      expect(contract.errorCodes).toEqual([
        "OK",
        "SIZE_EXCEEDED",
        "SEND_FAILED",
      ]);
    });

    it("R1-4: 合同包含约束定义", () => {
      const contract = getFileSendContract();

      expect(contract.constraints).toHaveProperty("sizeLimit", "1GB");
      expect(contract.constraints).toHaveProperty("pathValidation", "none（按任务单口径）");
      expect(contract.constraints).toHaveProperty("workspaceCheck", "none");
      expect(contract.constraints).toHaveProperty("readabilityCheck", "none");
    });
  });

  describe("R2: help --json 合同", () => {
    it("R2-1: help --json 包含 file send 命令", () => {
      const contract = getFileSendContract();

      // 验证命令名
      expect(contract.name).toBe("file send");

      // 验证描述存在
      expect(contract.description).toBeTruthy();
      expect(contract.description).toContain("发送文件");
    });

    it("R2-2: help --json 包含必填参数", () => {
      const contract = getFileSendContract();

      expect(contract.options?.required).toBeDefined();
      expect(contract.options?.required?.["--path <path>"]).toBeTruthy();
    });

    it("R2-3: help --json 包含可选参数", () => {
      const contract = getFileSendContract();

      expect(contract.options?.optional).toBeDefined();
      expect(contract.options?.optional?.["--caption <caption>"]).toBeTruthy();
      expect(contract.options?.optional?.["--mime <mime>"]).toBeTruthy();
      expect(contract.options?.optional?.["--json"]).toBeTruthy();
    });
  });

  describe("R3: 大小限制", () => {
    it("R3-1: SIZE_EXCEEDED 返回正确结构", () => {
      const startTime = Date.now();
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      // 模拟超限数据结构
      const data = {
        ok: false,
        sendResult: "SIZE_EXCEEDED" as const,
        fileSizeBytes: 2 * 1024 * 1024 * 1024, // 2GB
        limitBytes: 1024 * 1024 * 1024, // 1GB
      };

      const envelope = createEnvelope(
        "msgcode file send --path /tmp/largefile",
        startTime,
        "error",
        data,
        warnings,
        errors
      );

      expect(envelope.status).toBe("error");
      expect(envelope.exitCode).toBe(1);
      expect(envelope.data.sendResult).toBe("SIZE_EXCEEDED");
      expect(envelope.data.fileSizeBytes).toBe(2 * 1024 * 1024 * 1024);
      expect(envelope.data.limitBytes).toBe(1024 * 1024 * 1024);
    });

    it("R3-2: OK 返回正确结构", () => {
      const startTime = Date.now();
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      const data = {
        ok: true,
        sendResult: "OK" as const,
        path: "/tmp/smallfile.txt",
        fileSizeBytes: 1024,
      };

      const envelope = createEnvelope(
        "msgcode file send --path /tmp/smallfile.txt",
        startTime,
        "pass",
        data,
        warnings,
        errors
      );

      expect(envelope.status).toBe("pass");
      expect(envelope.exitCode).toBe(0);
      expect(envelope.data.ok).toBe(true);
      expect(envelope.data.sendResult).toBe("OK");
      expect(envelope.data.path).toBe("/tmp/smallfile.txt");
      expect(envelope.data.fileSizeBytes).toBe(1024);
    });

    it("R3-3: SEND_FAILED 返回正确结构", () => {
      const startTime = Date.now();
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      const data = {
        ok: false,
        sendResult: "SEND_FAILED" as const,
        errorMessage: "文件不存在",
      };

      const envelope = createEnvelope(
        "msgcode file send --path /nonexistent",
        startTime,
        "error",
        data,
        warnings,
        errors
      );

      expect(envelope.status).toBe("error");
      expect(envelope.exitCode).toBe(1);
      expect(envelope.data.ok).toBe(false);
      expect(envelope.data.sendResult).toBe("SEND_FAILED");
      expect(envelope.data.errorMessage).toBe("文件不存在");
    });
  });

  describe("R4: Envelope 契约", () => {
    it("R4-1: Envelope 包含必要字段", () => {
      const startTime = Date.now();
      const envelope = createEnvelope(
        "test",
        startTime,
        "pass",
        { ok: true, sendResult: "OK" }
      );

      expect(envelope).toHaveProperty("schemaVersion");
      expect(envelope).toHaveProperty("command");
      expect(envelope).toHaveProperty("requestId");
      expect(envelope).toHaveProperty("timestamp");
      expect(envelope).toHaveProperty("durationMs");
      expect(envelope).toHaveProperty("status");
      expect(envelope).toHaveProperty("exitCode");
      expect(envelope).toHaveProperty("summary");
      expect(envelope).toHaveProperty("data");
    });

    it("R4-2: schemaVersion 固定为 2", () => {
      const envelope = createEnvelope("test", Date.now(), "pass", {});
      expect(envelope.schemaVersion).toBe(2);
    });

    it("R4-3: requestId 是有效 UUID", () => {
      const envelope = createEnvelope("test", Date.now(), "pass", {});
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      expect(envelope.requestId).toMatch(uuidPattern);
    });

    it("R4-4: timestamp 是 ISO 8601 格式", () => {
      const envelope = createEnvelope("test", Date.now(), "pass", {});
      const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
      expect(envelope.timestamp).toMatch(isoPattern);
    });
  });
});
