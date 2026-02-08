/**
 * msgcode: Tool Bus BDD 测试
 *
 * 测试场景：
 * - Scenario A: explicit 模式拒绝 llm-tool-call
 * - Scenario B: autonomous 模式允许 llm-tool-call
 * - Scenario C: 工具灰度配置
 * - Scenario D: 工具执行记录到 telemetry
 * - Scenario E: shell 工具执行
 * - Scenario F: allowlist 仍生效
 * - Scenario G: 默认模式守卫（确保默认为 explicit）
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import type { ToolContext, ToolSource } from "../src/tools/types.js";
import { executeTool, canExecuteTool, getToolPolicy } from "../src/tools/bus.js";
import { recordToolEvent, getToolStats, clearToolEvents } from "../src/tools/telemetry.js";
import type { ToolPolicy, ToolName } from "../src/tools/types.js";

describe("Tool Bus", () => {
  let tempWorkspace: string;

  beforeEach(() => {
    // 创建临时工作区
    tempWorkspace = join(tmpdir(), `msgcode-test-${randomUUID()}`);
    mkdirSync(tempWorkspace, { recursive: true });

    // 清空 telemetry 事件
    clearToolEvents();
  });

  afterEach(() => {
    // 清理临时工作区
    if (existsSync(tempWorkspace)) {
      rmSync(tempWorkspace, { recursive: true, force: true });
    }

    // 清空 telemetry 事件
    clearToolEvents();
  });

  describe("Scenario A: explicit 模式拒绝 llm-tool-call", () => {
    test("应该拒绝 llm-tool-call 来源的工具调用", async () => {
      // 设置 explicit 模式配置
      const configDir = join(tempWorkspace, ".msgcode");
      mkdirSync(configDir, { recursive: true });
      writeFileSync(join(configDir, "config.json"), JSON.stringify({
        "tooling.mode": "explicit",
        "tooling.allow": ["tts", "asr", "vision"],
        "tooling.require_confirm": [],
      }));

      // 在 explicit 模式下，llm-tool-call 应该被拒绝
      const result = await executeTool(
        "tts",
        { text: "测试文本" },
        {
          workspacePath: tempWorkspace,
          source: "llm-tool-call",
          requestId: randomUUID(),
        }
      );

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("TOOL_NOT_ALLOWED");
      expect(result.error?.message).toContain("llm tool-call disabled in explicit mode");
    });

    test("应该允许 slash-command 来源的工具调用", async () => {
      const gate = canExecuteTool(
        { mode: "explicit", allow: ["tts"], requireConfirm: [] },
        "tts",
        "slash-command"
      );

      expect(gate.ok).toBe(true);
    });

    test("应该允许 media-pipeline 来源的 asr/vision", async () => {
      const policy: ToolPolicy = { mode: "explicit", allow: ["tts", "asr", "vision"], requireConfirm: [] };

      // asr 应该被允许
      const asrGate = canExecuteTool(policy, "asr", "media-pipeline");
      expect(asrGate.ok).toBe(true);

      // vision 应该被允许
      const visionGate = canExecuteTool(policy, "vision", "media-pipeline");
      expect(visionGate.ok).toBe(true);
    });

    test("应该拒绝 media-pipeline 来源的非 asr/vision 工具", async () => {
      const policy: ToolPolicy = { mode: "explicit", allow: ["tts", "asr", "vision", "shell"], requireConfirm: [] };

      // shell 不应该被 media-pipeline 调用
      const shellGate = canExecuteTool(policy, "shell", "media-pipeline");
      expect(shellGate.ok).toBe(false);
      expect(shellGate.code).toBe("TOOL_NOT_ALLOWED");
      // 即使 shell 在 allow 列表中，media-pipeline 也不应该能调用它
      expect(shellGate.message).toContain("not allowed from media-pipeline");
    });

    test("应该允许 internal 来源的工具调用", async () => {
      const gate = canExecuteTool(
        { mode: "explicit", allow: ["tts"], requireConfirm: [] },
        "tts",
        "internal"
      );

      expect(gate.ok).toBe(true);
    });
  });

  describe("Scenario B: autonomous 模式允许 llm-tool-call", () => {
    test("应该允许 llm-tool-call 来源的工具调用", async () => {
      const gate = canExecuteTool(
        { mode: "autonomous", allow: ["tts", "asr", "shell"], requireConfirm: [] },
        "tts",
        "llm-tool-call"
      );

      expect(gate.ok).toBe(true);
    });

    test("应该允许 llm-tool-call 来源调用 shell", async () => {
      const gate = canExecuteTool(
        { mode: "autonomous", allow: ["tts", "asr", "shell"], requireConfirm: [] },
        "shell",
        "llm-tool-call"
      );

      expect(gate.ok).toBe(true);
    });

    test("应该允许 llm-tool-call 来源调用 browser", async () => {
      const gate = canExecuteTool(
        { mode: "autonomous", allow: ["browser"], requireConfirm: [] },
        "browser",
        "llm-tool-call"
      );

      expect(gate.ok).toBe(true);
    });

    test("应该读取默认配置为 explicit", async () => {
      const policy = await getToolPolicy(tempWorkspace);

      // 默认配置：explicit 模式（稳态），只允许基础工具
      expect(policy.mode).toBe("explicit");
      expect(policy.allow).toContain("tts");
      expect(policy.allow).toContain("asr");
      expect(policy.allow).toContain("vision");
      // 默认不应该包含高风险工具
      expect(policy.allow).not.toContain("shell");
      expect(policy.allow).not.toContain("browser");
    });

    test("应该从 workspace config.json 读取配置", () => {
      const configDir = join(tempWorkspace, ".msgcode");
      mkdirSync(configDir, { recursive: true });

      const configPath = join(configDir, "config.json");
      writeFileSync(configPath, JSON.stringify({
        "tooling.mode": "explicit",
        "tooling.allow": ["tts"], // 只允许 tts
        "tooling.require_confirm": ["shell", "browser"],
      }));

      // 需要重新加载配置才能看到效果
      // 这里测试配置文件可以正确写入
      const content = JSON.parse(Buffer.from(readFileSync(configPath)).toString());
      expect(content["tooling.allow"]).toEqual(["tts"]);
    });
  });

  describe("Scenario C: 工具灰度配置", () => {
    test("应该从 workspace config.json 读取配置", () => {
      const configDir = join(tempWorkspace, ".msgcode");
      mkdirSync(configDir, { recursive: true });

      const configPath = join(configDir, "config.json");
      writeFileSync(configPath, JSON.stringify({
        "tooling.mode": "explicit",
        "tooling.allow": ["tts"], // 只允许 tts
        "tooling.require_confirm": ["shell", "browser"],
      }));

      // 需要重新加载配置才能看到效果
      // 这里测试配置文件可以正确写入
      const content = JSON.parse(Buffer.from(readFileSync(configPath)).toString());
      expect(content["tooling.allow"]).toEqual(["tts"]);
    });
  });

  describe("Scenario D: 工具执行记录到 telemetry", () => {
    test("应该记录成功的工具执行", async () => {
      clearToolEvents();

      // 显式允许 shell，避免触发真实 TTS/发送链路导致测试卡住
      const configDir = join(tempWorkspace, ".msgcode");
      mkdirSync(configDir, { recursive: true });
      writeFileSync(join(configDir, "config.json"), JSON.stringify({
        "tooling.mode": "explicit",
        "tooling.allow": ["shell"],
        "tooling.require_confirm": [],
      }));

      const requestId = randomUUID();
      const result = await executeTool(
        "shell",
        { command: "echo 42" },
        {
          workspacePath: tempWorkspace,
          source: "slash-command",
          requestId,
        }
      );

      expect(result.ok).toBe(true);

      const stats = getToolStats(60000); // 1 分钟窗口
      expect(stats.totalCalls).toBe(1);
      expect(stats.successCount).toBe(1);
      expect(stats.byTool.shell?.calls).toBe(1);
    });

    test("应该记录失败的工具执行", async () => {
      clearToolEvents();

      // 设置 explicit 模式配置
      const configDir = join(tempWorkspace, ".msgcode");
      mkdirSync(configDir, { recursive: true });
      writeFileSync(join(configDir, "config.json"), JSON.stringify({
        "tooling.mode": "explicit",
        "tooling.allow": ["tts"], // 不包含 shell
        "tooling.require_confirm": [],
      }));

      const requestId = randomUUID();
      const result = await executeTool(
        "shell",
        { command: "ls" },
        {
          workspacePath: tempWorkspace,
          source: "llm-tool-call", // 会被 explicit 模式拒绝
          requestId,
        }
      );

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("TOOL_NOT_ALLOWED");

      // 应该记录到 telemetry
      const stats = getToolStats(60000);
      expect(stats.totalCalls).toBeGreaterThan(0);
      expect(stats.failureCount).toBeGreaterThan(0);
    });

    test("应该正确计算统计数据", async () => {
      clearToolEvents();

      // 记录一些测试事件
      recordToolEvent({
        requestId: randomUUID(),
        workspacePath: tempWorkspace,
        tool: "tts",
        source: "slash-command",
        durationMs: 100,
        ok: true,
        artifactPaths: ["/path/to/audio.wav"],
        timestamp: Date.now(),
      });

      recordToolEvent({
        requestId: randomUUID(),
        workspacePath: tempWorkspace,
        tool: "tts",
        source: "slash-command",
        durationMs: 150,
        ok: true,
        artifactPaths: ["/path/to/audio2.wav"],
        timestamp: Date.now(),
      });

      recordToolEvent({
        requestId: randomUUID(),
        workspacePath: tempWorkspace,
        tool: "asr",
        source: "media-pipeline",
        durationMs: 500,
        ok: false,
        errorCode: "TOOL_EXEC_FAILED",
        artifactPaths: [],
        timestamp: Date.now(),
      });

      const stats = getToolStats(60000);

      expect(stats.totalCalls).toBe(3);
      expect(stats.successCount).toBe(2);
      expect(stats.failureCount).toBe(1);
      expect(stats.successRate).toBeCloseTo(2/3, 1);
      expect(stats.avgDurationMs).toBeCloseTo((100 + 150 + 500) / 3, 0);
      expect(stats.byTool["tts"].calls).toBe(2);
      expect(stats.byTool["tts"].successRate).toBe(1);
      expect(stats.byTool["asr"].calls).toBe(1);
      expect(stats.byTool["asr"].successRate).toBe(0);
      expect(stats.topErrorCodes[0].code).toBe("TOOL_EXEC_FAILED");
      expect(stats.topErrorCodes[0].count).toBe(1);
      expect(stats.bySource["slash-command"]).toBe(2);
      expect(stats.bySource["media-pipeline"]).toBe(1);
    });
  });

  describe("Scenario D: Ring buffer 行为", () => {
    test("应该限制最大事件数量", () => {
      clearToolEvents();

      // 记录超过 200 个事件
      for (let i = 0; i < 250; i++) {
        recordToolEvent({
          requestId: randomUUID(),
          workspacePath: tempWorkspace,
          tool: "tts",
          source: "slash-command",
          durationMs: 100,
          ok: true,
          artifactPaths: [],
          timestamp: Date.now(),
        });
      }

      const stats = getToolStats();
      // 应该只保留最近 200 个事件
      expect(stats.totalCalls).toBe(200);
    });

    test("应该正确过滤时间窗口内的事件", () => {
      clearToolEvents();

      const now = Date.now();

      // 记录一个旧事件（2 小时前）
      recordToolEvent({
        requestId: randomUUID(),
        workspacePath: tempWorkspace,
        tool: "tts",
        source: "slash-command",
        durationMs: 100,
        ok: true,
        artifactPaths: [],
        timestamp: now - 7200000, // 2 小时前
      });

      // 记录一个新事件（5 分钟前）
      recordToolEvent({
        requestId: randomUUID(),
        workspacePath: tempWorkspace,
        tool: "asr",
        source: "media-pipeline",
        durationMs: 200,
        ok: true,
        artifactPaths: [],
        timestamp: now - 300000, // 5 分钟前
      });

      // 1 小时窗口应该只包含 5 分钟前的事件
      const stats1h = getToolStats(3600000);
      expect(stats1h.totalCalls).toBe(1);
      expect(stats1h.byTool["asr"].calls).toBe(1);

      // 3 小时窗口应该包含两个事件
      const stats3h = getToolStats(10800000);
      expect(stats3h.totalCalls).toBe(2);
    });
  });

  describe("Scenario E: shell 工具执行", () => {
    beforeEach(() => {
      // Scenario E: 设置 autonomous 模式并允许 shell
      const configDir = join(tempWorkspace, ".msgcode");
      mkdirSync(configDir, { recursive: true });
      writeFileSync(join(configDir, "config.json"), JSON.stringify({
        "tooling.mode": "autonomous",
        "tooling.allow": ["tts", "asr", "vision", "shell"],
        "tooling.require_confirm": [],
      }));
    });

    test("应该成功执行 shell 命令并返回结果", async () => {
      // 在 macOS 上，echo 命令应该成功
      const result = await executeTool(
        "shell",
        { command: "echo 'hello world'" },
        {
          workspacePath: tempWorkspace,
          source: "slash-command",
          requestId: randomUUID(),
        }
      );

      expect(result.ok).toBe(true);
      expect(result.tool).toBe("shell");
      expect(result.data?.exitCode).toBe(0);
      expect(result.data?.stdout).toContain("hello world");
    });

    test("应该记录 shell 执行到 telemetry", async () => {
      clearToolEvents();

      await executeTool(
        "shell",
        { command: "echo 'test'" },
        {
          workspacePath: tempWorkspace,
          source: "llm-tool-call",
          requestId: randomUUID(),
        }
      );

      const stats = getToolStats(60000);
      expect(stats.totalCalls).toBeGreaterThan(0);
      expect(stats.byTool["shell"]).toBeDefined();
    });

    test("shell 命令失败时应该返回非零退出码", async () => {
      const result = await executeTool(
        "shell",
        { command: "exit 1" }, // 模拟失败命令
        {
          workspacePath: tempWorkspace,
          source: "slash-command",
          requestId: randomUUID(),
        }
      );

      expect(result.ok).toBe(false);
      expect(result.data?.exitCode).toBe(1);
    });

    test("空命令应该返回错误", async () => {
      const result = await executeTool(
        "shell",
        { command: "   " }, // 只有空格
        {
          workspacePath: tempWorkspace,
          source: "slash-command",
          requestId: randomUUID(),
        }
      );

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("TOOL_EXEC_FAILED");
    });
  });

  describe("Scenario F: allowlist 仍生效", () => {
    test("allowlist 中没有的工具应该被拒绝", () => {
      const policy: ToolPolicy = {
        mode: "autonomous",
        allow: ["tts", "asr"], // 不包含 shell
        requireConfirm: [],
      };

      const gate = canExecuteTool(policy, "shell", "llm-tool-call");
      expect(gate.ok).toBe(false);
      expect(gate.code).toBe("TOOL_NOT_ALLOWED");
      expect(gate.message).toContain("tool not allowed: shell");
    });

    test("autonomous 模式下 allowlist 仍然生效", () => {
      const policy: ToolPolicy = {
        mode: "autonomous",
        allow: ["tts"], // 只允许 tts
        requireConfirm: [],
      };

      // tts 应该被允许
      const ttsGate = canExecuteTool(policy, "tts", "llm-tool-call");
      expect(ttsGate.ok).toBe(true);

      // asr 不在 allowlist 中，应该被拒绝
      const asrGate = canExecuteTool(policy, "asr", "llm-tool-call");
      expect(asrGate.ok).toBe(false);
      expect(asrGate.code).toBe("TOOL_NOT_ALLOWED");
    });

    test("从 allowlist 移除工具后执行应该被拒绝", async () => {
      // 创建配置文件，只允许 tts 和 asr
      const configDir = join(tempWorkspace, ".msgcode");
      mkdirSync(configDir, { recursive: true });

      const configPath = join(configDir, "config.json");
      writeFileSync(configPath, JSON.stringify({
        "tooling.mode": "autonomous",
        "tooling.allow": ["tts", "asr"], // 不包含 shell
        "tooling.require_confirm": [],
      }));

      const result = await executeTool(
        "shell",
        { command: "echo test" },
        {
          workspacePath: tempWorkspace,
          source: "llm-tool-call",
          requestId: randomUUID(),
        }
      );

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("TOOL_NOT_ALLOWED");
    });
  });

  describe("Scenario G: 默认模式守卫（确保默认为 explicit）", () => {
    test("默认配置应该是 explicit 模式", async () => {
      // 不设置任何配置文件，测试默认值
      const policy = await getToolPolicy(tempWorkspace);

      // 默认必须是 explicit（稳态）
      expect(policy.mode).toBe("explicit");

      // 默认 allowlist 应该只包含基础工具
      expect(policy.allow).toContain("tts");
      expect(policy.allow).toContain("asr");
      expect(policy.allow).toContain("vision");
      // 默认不应该包含高风险工具
      expect(policy.allow).not.toContain("shell");
      expect(policy.allow).not.toContain("browser");
    });

    test("explicit 模式下应该拒绝 llm-tool-call 来源", async () => {
      // 使用默认配置（explicit）
      const result = await executeTool(
        "tts",
        { text: "测试" },
        {
          workspacePath: tempWorkspace,
          source: "llm-tool-call",
          requestId: randomUUID(),
        }
      );

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("TOOL_NOT_ALLOWED");
      expect(result.error?.message).toContain("llm tool-call disabled in explicit mode");
    });

    test("explicit 模式下应该允许 slash-command 来源", async () => {
      const policy = await getToolPolicy(tempWorkspace);
      const gate = canExecuteTool(policy, "tts", "slash-command");

      expect(gate.ok).toBe(true);
    });
  });
});
