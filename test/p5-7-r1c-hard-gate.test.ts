/**
 * msgcode: P5.7-R1c CLI 基座能力硬门回归锁
 *
 * 验证：
 * 1. 新增命令任务是否包含真实成功/失败证据字段
 * 2. 阻止 .only/.skip 漏网
 * 3. 检查 help-docs --json 合同完整性
 */

import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ============================================
// 辅助函数
// ============================================

/**
 * 递归查找目录下所有 .md 文件
 */
function findMarkdownFiles(dir: string, files: string[] = []): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      findMarkdownFiles(fullPath, files);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * 检查任务单是否包含真实链路证据
 */
function hasRealDeliveryEvidence(content: string): boolean {
  // 检查是否包含真实成功/失败证据的关键词
  const successKeywords = [
    '真实成功',
    '真实成功证据',
    '真实链路',
    '成功链路',
    '真发送',
    '真抓取',
    '真实执行',
    '非 mock',
  ];

  const failureKeywords = [
    '真实失败',
    '真实失败证据',
    '失败链路',
    '错误码',
    'errorCode',
    'SEND_FAILED',
    'FETCH_FAILED',
  ];

  const hasSuccess = successKeywords.some(kw => content.includes(kw));
  const hasFailure = failureKeywords.some(kw => content.includes(kw));

  return hasSuccess && hasFailure;
}

/**
 * 检查是否有 .only 或 .skip
 */
function hasOnlyOrSkip(content: string): boolean {
  return /\.only\s*\(/.test(content) || /\.skip\s*\(/.test(content);
}

// ============================================
// 测试：硬门检查
// ============================================

describe("P5.7-R1c: CLI 基座能力硬门回归锁", () => {
  const tasksDir = join(process.cwd(), "docs/tasks");

  describe("R1c-1: 任务单真实链路证据", () => {
    it("P5.7-R1b 任务单包含真实成功/失败证据", () => {
      const content = readFileSync(
        join(tasksDir, "p5-7-r1b-file-send-real-delivery.md"),
        "utf-8"
      );
      expect(hasRealDeliveryEvidence(content)).toBe(true);
    });

    it("P5.7-R1c 任务单包含硬门说明", () => {
      const content = readFileSync(
        join(tasksDir, "p5-7-r1c-cli-substrate-capability-baseline.md"),
        "utf-8"
      );
      expect(content).toContain("能力硬门");
      expect(content).toContain("真实成功");
      expect(content).toContain("真实失败");
    });

    it("P5.7 总纲包含硬门清单", () => {
      const content = readFileSync(
        join(tasksDir, "p5-7-cli-first-skill-expansion-master-plan.md"),
        "utf-8"
      );
      expect(content).toContain("能力硬门");
      expect(content).toContain("安全底线");
      expect(content).toContain("观测字段");
    });
  });

  describe("R1c-2: 阻止 .only/.skip 漏网", () => {
    it("test/p5-7*.test.ts 无 .only/.skip", () => {
      const testFiles = readdirSync(join(process.cwd(), "test"))
        .filter(f => f.startsWith("p5-7") && f.endsWith(".test.ts"));

      for (const file of testFiles) {
        const content = readFileSync(
          join(process.cwd(), "test", file),
          "utf-8"
        );
        expect(hasOnlyOrSkip(content)).toBe(false);
      }
    });

    it("src/cli/*.ts 无 .only/.skip", () => {
      const cliFiles = readdirSync(join(process.cwd(), "src/cli"))
        .filter(f => f.endsWith(".ts"));

      for (const file of cliFiles) {
        const content = readFileSync(
          join(process.cwd(), "src/cli", file),
          "utf-8"
        );
        expect(hasOnlyOrSkip(content)).toBe(false);
      }
    });
  });

  describe("R1c-3: help-docs 合同完整性", () => {
    it("file send 合同包含 --to 必填参数", () => {
      const { getFileSendContract } = require("../src/cli/file.js");
      const contract = getFileSendContract();

      expect(contract.options?.required).toHaveProperty("--path <path>");
      expect(contract.options?.required).toHaveProperty("--to <chat-guid>");
    });

    it("file send 合同包含 deliveryChannel", () => {
      const { getFileSendContract } = require("../src/cli/file.js");
      const contract = getFileSendContract();

      expect(contract.constraints).toHaveProperty("deliveryChannel");
    });

    it("web search 合同包含错误码", () => {
      const { getWebCommandContract } = require("../src/cli/web.js");
      const contracts = getWebCommandContract();
      const searchContract = contracts.find((c: any) => c.name === "web search");

      expect(searchContract.errorCodes).toContain("OK");
      expect(searchContract.errorCodes).toContain("SEARCH_FAILED");
    });

    it("system info 合同包含错误码", () => {
      const { getSystemCommandContract } = require("../src/cli/system.js");
      const contracts = getSystemCommandContract();
      const infoContract = contracts.find((c: any) => c.name === "system info");

      expect(infoContract.errorCodes).toContain("OK");
      expect(infoContract.errorCodes).toContain("INFO_FAILED");
    });
  });

  describe("R1c-4: 退出码规范", () => {
    it("file send 退出码映射正确", () => {
      const { createEnvelope } = require("../src/cli/file.js");

      const passEnvelope = createEnvelope("test", Date.now(), "pass", { ok: true });
      expect(passEnvelope.exitCode).toBe(0);

      const warningEnvelope = createEnvelope("test", Date.now(), "warning", { ok: false });
      expect(warningEnvelope.exitCode).toBe(2);

      const errorEnvelope = createEnvelope("test", Date.now(), "error", { ok: false });
      expect(errorEnvelope.exitCode).toBe(1);
    });
  });
});
