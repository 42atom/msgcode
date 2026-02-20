/**
 * msgcode: P5.7-R1b CLI-First File Send 真实交付回归测试
 *
 * 验证：
 * 1. file send 命令合同（含 --to 必填）
 * 2. help-docs --json 包含 file send
 * 3. 大小限制检查
 * 4. Envelope 契约
 */

import { describe, it, expect } from "bun:test";
import { getFileSendContract, createEnvelope } from "../src/cli/file.js";
import type { Diagnostic } from "../src/memory/types.js";

// ============================================
// File Send 合同测试（P5.7-R1b）
// ============================================

describe("P5.7-R1b: CLI-First File Send 真实交付", () => {
  describe("R1: 命令合同", () => {
    it("R1b-1: getFileSendContract 返回完整合同（含 --to）", () => {
      const contract = getFileSendContract();

      expect(contract).toHaveProperty("name", "file send");
      expect(contract).toHaveProperty("description");
      expect(contract).toHaveProperty("options");

      // R1b: --to 为必填
      expect(contract.options?.required).toHaveProperty("--path <path>");
      expect(contract.options?.required).toHaveProperty("--to <chat-guid>");

      expect(contract.options?.optional).toHaveProperty("--caption <caption>");
      expect(contract.options?.optional).toHaveProperty("--mime <mime>");
      expect(contract.options?.optional).toHaveProperty("--json");
    });

    it("R1b-2: 合同包含输出结构定义（含 to 字段）", () => {
      const contract = getFileSendContract();

      expect(contract.output).toHaveProperty("success");
      expect(contract.output?.success).toEqual({
        ok: true,
        sendResult: "OK",
        path: "<文件路径>",
        to: "<目标聊天 GUID>",
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
      expect(contract.output?.sendFailed).toHaveProperty("ok", false);
      expect(contract.output?.sendFailed).toHaveProperty("sendResult", "SEND_FAILED");
      expect(contract.output?.sendFailed).toHaveProperty("errorCode");
      expect(contract.output?.sendFailed).toHaveProperty("errorMessage");
    });

    it("R1b-3: 合同包含错误码枚举", () => {
      const contract = getFileSendContract();

      expect(contract.errorCodes).toEqual([
        "OK",
        "SIZE_EXCEEDED",
        "SEND_FAILED",
      ]);
    });

    it("R1b-4: 合同包含约束定义（含 deliveryChannel）", () => {
      const contract = getFileSendContract();

      expect(contract.constraints).toHaveProperty("sizeLimit", "1GB");
      expect(contract.constraints).toHaveProperty("pathValidation", "none（按任务单口径）");
      expect(contract.constraints).toHaveProperty("workspaceCheck", "none");
      expect(contract.constraints).toHaveProperty("readabilityCheck", "none");
      expect(contract.constraints).toHaveProperty("deliveryChannel", "iMessage RPC (send)");
    });
  });

  describe("R2: help-docs --json 合同", () => {
    it("R2-1: help-docs --json 包含 file send 命令", () => {
      const contract = getFileSendContract();

      expect(contract.name).toBe("file send");
      expect(contract.description).toBeTruthy();
      expect(contract.description).toContain("真实发送");
    });

    it("R2-2: help-docs --json 包含 --to 必填参数", () => {
      const contract = getFileSendContract();

      expect(contract.options?.required).toBeDefined();
      expect(contract.options?.required?.["--to <chat-guid>"]).toBeTruthy();
    });

    it("R2-3: help-docs --json 包含可选参数", () => {
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

      const data = {
        ok: false,
        sendResult: "SIZE_EXCEEDED" as const,
        fileSizeBytes: 2 * 1024 * 1024 * 1024,
        limitBytes: 1024 * 1024 * 1024,
      };

      const envelope = createEnvelope(
        "msgcode file send --path /tmp/largefile --to test-guid",
        startTime,
        "error",
        data,
        warnings,
        errors
      );

      expect(envelope.status).toBe("error");
      expect(envelope.exitCode).toBe(1);
      expect(envelope.data.sendResult).toBe("SIZE_EXCEEDED");
    });

    it("R3-2: OK 返回正确结构（含 to）", () => {
      const startTime = Date.now();
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      const data = {
        ok: true,
        sendResult: "OK" as const,
        path: "/tmp/smallfile.txt",
        to: "iMessage;+;test-guid",
        fileSizeBytes: 1024,
      };

      const envelope = createEnvelope(
        "msgcode file send --path /tmp/smallfile.txt --to iMessage;+;test-guid",
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
      expect(envelope.data.to).toBe("iMessage;+;test-guid");
    });

    it("R3-3: SEND_FAILED 返回正确结构（含 errorCode）", () => {
      const startTime = Date.now();
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      const data = {
        ok: false,
        sendResult: "SEND_FAILED" as const,
        errorCode: "IMSG_SEND_FAILED",
        errorMessage: "iMessage 发送失败",
      };

      const envelope = createEnvelope(
        "msgcode file send --path /tmp/file.txt --to invalid-guid",
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
      expect(envelope.data.errorCode).toBe("IMSG_SEND_FAILED");
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

  describe("R5: --to 参数校验", () => {
    it("R5-1: 成功场景数据结构", () => {
      const startTime = Date.now();
      const data = {
        ok: true,
        sendResult: "OK" as const,
        path: "/test/file.txt",
        to: "iMessage;+;chat123",
        fileSizeBytes: 512,
      };

      const envelope = createEnvelope(
        "msgcode file send --path /test/file.txt --to iMessage;+;chat123",
        startTime,
        "pass",
        data
      );

      expect(envelope.data.ok).toBe(true);
      expect(envelope.data.to).toBe("iMessage;+;chat123");
    });

    it("R5-2: 失败场景含 errorCode", () => {
      const startTime = Date.now();
      const data = {
        ok: false,
        sendResult: "SEND_FAILED" as const,
        errorCode: "FILE_NOT_FOUND",
        errorMessage: "文件不存在",
      };

      const envelope = createEnvelope(
        "msgcode file send --path /missing --to iMessage;+;chat123",
        startTime,
        "error",
        data
      );

      expect(envelope.data.errorCode).toBe("FILE_NOT_FOUND");
    });
  });
});
