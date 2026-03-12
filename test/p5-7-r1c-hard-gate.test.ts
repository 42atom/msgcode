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
import { runCliIsolated } from "./helpers/cli-process.js";

function runCli(args: string[]) {
  return runCliIsolated(args);
}

/**
 * 检查任务单是否包含真实链路证据
 */
function hasRealDeliveryEvidence(content: string): boolean {
  const successKeywords = [
    "真实成功",
    "真实成功证据",
    "真实链路",
    "成功链路",
    "真发送",
    "真抓取",
    "真实执行",
    "非 mock",
  ];

  const failureKeywords = [
    "真实失败",
    "真实失败证据",
    "失败链路",
    "错误码",
    "errorCode",
    "SEND_FAILED",
    "FETCH_FAILED",
  ];

  const hasSuccess = successKeywords.some((kw) => content.includes(kw));
  const hasFailure = failureKeywords.some((kw) => content.includes(kw));

  return hasSuccess && hasFailure;
}

function hasOnlyOrSkip(content: string): boolean {
  return /\.only\s*\(/.test(content) || /\.skip\s*\(/.test(content);
}

describe("P5.7-R1c: CLI 基座能力硬门回归锁", () => {
  const tasksDir = join(process.cwd(), "docs/tasks");
  const archiveDir = join(process.cwd(), "docs/archive/retired-imsg-cli");

  describe("R1c-1: 任务单真实链路证据", () => {
    it("归档的 P5.7-R1b 任务单仍保留真实成功/失败证据", () => {
      const content = readFileSync(
        join(archiveDir, "p5-7-r1b-file-send-real-delivery.md"),
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
      const testFiles = readdirSync(join(process.cwd(), "test")).filter(
        (f) => f.startsWith("p5-7") && f.endsWith(".test.ts")
      );

      for (const file of testFiles) {
        const content = readFileSync(join(process.cwd(), "test", file), "utf-8");
        expect(hasOnlyOrSkip(content)).toBe(false);
      }
    });

    it("src/cli/*.ts 无 .only/.skip", () => {
      const cliFiles = readdirSync(join(process.cwd(), "src/cli")).filter((f) =>
        f.endsWith(".ts")
      );

      for (const file of cliFiles) {
        const content = readFileSync(join(process.cwd(), "src/cli", file), "utf-8");
        expect(hasOnlyOrSkip(content)).toBe(false);
      }
    });
  });

  describe("R1c-3: help-docs 合同完整性", () => {
    it("help-docs --json 不应再暴露 retired file send 合同", () => {
      const result = runCli(["help-docs", "--json"]);
      expect(result.status).toBe(0);

      const envelope = JSON.parse(result.stdout);
      const names = envelope.data.commands.map((command: { name: string }) => command.name);
      expect(names).not.toContain("file send");
    });

    it("file send 现在应直接返回 unknown command", () => {
      const result = runCli(["file", "send", "--json"]);
      expect(result.status).toBe(1);
      const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
      expect(output).toContain("unknown command");
      expect(output).toContain("file");
    });

    it("help-docs 不应再暴露 file/system/web/media 包装层", () => {
      const result = runCli(["help-docs", "--json"]);
      const envelope = JSON.parse(result.stdout);
      const names = envelope.data.commands.map((command: any) => command.name);

      expect(names.some((name: string) => name.startsWith("file "))).toBe(false);
      expect(names.some((name: string) => name.startsWith("system "))).toBe(false);
      expect(names.some((name: string) => name.startsWith("web "))).toBe(false);
      expect(names.some((name: string) => name.startsWith("media "))).toBe(false);
    });
  });

  describe("R1c-4: 退出码规范", () => {
    it("file helpers 的 exitCode 映射正确", () => {
      const { createEnvelope } = require("../src/cli/command-runner.js");

      const passEnvelope = createEnvelope("test", Date.now(), "pass", { ok: true });
      expect(passEnvelope.exitCode).toBe(0);

      const warningEnvelope = createEnvelope("test", Date.now(), "warning", { ok: false });
      expect(warningEnvelope.exitCode).toBe(2);

      const errorEnvelope = createEnvelope("test", Date.now(), "error", { ok: false });
      expect(errorEnvelope.exitCode).toBe(1);
    });

    it("job run --help 不应再暴露 --no-delivery", () => {
      const result = runCli(["job", "run", "--help"]);

      expect(result.status).toBe(0);
      expect(result.stdout).not.toContain("--no-delivery");
    });
  });
});
