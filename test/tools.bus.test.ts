/**
 * msgcode: Tool Bus BDD 测试
 *
 * 测试场景：
 * - Scenario A: explicit 模式拒绝 llm-tool-call
 * - Scenario B: autonomous 模式允许 llm-tool-call
 * - Scenario C: 工具灰度配置
 * - Scenario D: 工具执行记录到 telemetry
 * - Scenario E: bash 工具执行
 * - Scenario F: allowlist 仍生效
 * - Scenario G: 默认模式守卫（确保默认为 explicit）
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import type { ToolContext, ToolSource } from "../src/tools/types.js";
import { executeTool, canExecuteTool, getToolPolicy } from "../src/tools/bus.js";
import { recordToolEvent, getToolStats, clearToolEvents } from "../src/tools/telemetry.js";
import type { ToolPolicy, ToolName } from "../src/tools/types.js";
import { getToolPolicy as getWorkspaceToolPolicy } from "../src/config/workspace.js";

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
      const policy: ToolPolicy = { mode: "explicit", allow: ["tts", "asr", "vision", "bash"], requireConfirm: [] };

      // bash 不应该被 media-pipeline 调用
      const bashGate = canExecuteTool(policy, "bash", "media-pipeline");
      expect(bashGate.ok).toBe(false);
      expect(bashGate.code).toBe("TOOL_NOT_ALLOWED");
      // 即使 bash 在 allow 列表中，media-pipeline 也不应该能调用它
      expect(bashGate.message).toContain("not allowed from media-pipeline");
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
    test("Tool Bus 与 workspace 应共享同一份工具策略读取口径", async () => {
      const configDir = join(tempWorkspace, ".msgcode");
      mkdirSync(configDir, { recursive: true });
      writeFileSync(join(configDir, "config.json"), JSON.stringify({
        "tooling.mode": "explicit",
        "tooling.allow": ["bash", "read_file"],
        "tooling.require_confirm": ["bash"],
      }));

      const fromBus = await getToolPolicy(tempWorkspace);
      const fromWorkspace = await getWorkspaceToolPolicy(tempWorkspace);

      expect(fromBus).toEqual(fromWorkspace);
    });

    test("应该允许 llm-tool-call 来源的工具调用", async () => {
      const gate = canExecuteTool(
        { mode: "autonomous", allow: ["tts", "asr", "bash"], requireConfirm: [] },
        "tts",
        "llm-tool-call"
      );

      expect(gate.ok).toBe(true);
    });

    test("应该允许 llm-tool-call 来源调用 bash", async () => {
      const gate = canExecuteTool(
        { mode: "autonomous", allow: ["tts", "asr", "bash"], requireConfirm: [] },
        "bash",
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

    test("autonomous 模式下 allow 显式包含 vision 时，llm-tool-call 应允许执行它", async () => {
      const gate = canExecuteTool(
        { mode: "autonomous", allow: ["vision", "bash"], requireConfirm: [] },
        "vision",
        "llm-tool-call"
      );

      expect(gate.ok).toBe(true);
    });

    test("autonomous 模式下 allow 包含 edit_file 时，llm-tool-call 应允许执行它", async () => {
      const gate = canExecuteTool(
        { mode: "autonomous", allow: ["bash", "read_file", "edit_file"], requireConfirm: [] },
        "edit_file",
        "llm-tool-call"
      );

      expect(gate.ok).toBe(true);
    });

    test("应该读取默认配置为 autonomous（P5.5 测试期）", async () => {
      const policy = await getToolPolicy(tempWorkspace);

      // P5.5: 测试期默认 autonomous（LLM 自主决策 tool_calls）
      expect(policy.mode).toBe("autonomous");
      expect(policy.allow).toContain("tts");
      expect(policy.allow).toContain("asr");
      // 默认工具策略与 workspace 默认配置保持一致（文件主链恢复为第一公民 read/write/edit + bash）
      expect(policy.allow).toContain("bash");
      expect(policy.allow).toContain("browser");
      expect(policy.allow).toContain("read_file");
      expect(policy.allow).toContain("write_file");
      expect(policy.allow).toContain("edit_file");
      expect(policy.allow).toContain("help_docs");
      expect(policy.allow).toContain("feishu_list_members");
      expect(policy.allow).toContain("feishu_list_recent_messages");
      expect(policy.allow).toContain("feishu_reply_message");
      expect(policy.allow).toContain("feishu_react_message");
    });

    test("应该从 workspace config.json 读取配置", () => {
      const configDir = join(tempWorkspace, ".msgcode");
      mkdirSync(configDir, { recursive: true });

      const configPath = join(configDir, "config.json");
      writeFileSync(configPath, JSON.stringify({
        "tooling.mode": "explicit",
        "tooling.allow": ["tts"], // 只允许 tts
        "tooling.require_confirm": ["bash", "browser"],
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
        "tooling.require_confirm": ["bash", "browser"],
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

      // 显式允许 bash，避免触发真实 TTS/发送链路导致测试卡住
      const configDir = join(tempWorkspace, ".msgcode");
      mkdirSync(configDir, { recursive: true });
      writeFileSync(join(configDir, "config.json"), JSON.stringify({
        "tooling.mode": "explicit",
        "tooling.allow": ["bash"],
        "tooling.require_confirm": [],
      }));

      const requestId = randomUUID();
      const result = await executeTool(
        "bash",
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
      expect(stats.byTool.bash?.calls).toBe(1);
    });

    test("应该记录失败的工具执行", async () => {
      clearToolEvents();

      // 设置 explicit 模式配置
      const configDir = join(tempWorkspace, ".msgcode");
      mkdirSync(configDir, { recursive: true });
      writeFileSync(join(configDir, "config.json"), JSON.stringify({
        "tooling.mode": "explicit",
        "tooling.allow": ["tts"], // 不包含 bash
        "tooling.require_confirm": [],
      }));

      const requestId = randomUUID();
      const result = await executeTool(
        "bash",
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

  describe("Scenario H: 文件工具跨 workspace 访问", () => {
    test("read_file 应允许读取 workspace 外绝对路径", async () => {
      const externalFile = join(tmpdir(), `msgcode-external-read-${randomUUID()}.txt`);
      writeFileSync(externalFile, "external-read-ok");

      try {
        const configDir = join(tempWorkspace, ".msgcode");
        mkdirSync(configDir, { recursive: true });
        writeFileSync(join(configDir, "config.json"), JSON.stringify({
          "tooling.mode": "explicit",
          "tooling.allow": ["read_file"],
          "tooling.require_confirm": [],
        }));

        const result = await executeTool(
          "read_file",
          { path: externalFile },
          {
            workspacePath: tempWorkspace,
            source: "slash-command",
            requestId: randomUUID(),
          }
        );

        expect(result.ok).toBe(true);
        expect(result.data?.content).toBe("external-read-ok");
      } finally {
        rmSync(externalFile, { force: true });
      }
    });

    test("write_file 应允许写入 workspace 外绝对路径", async () => {
      const externalFile = join(tmpdir(), `msgcode-external-write-${randomUUID()}.txt`);

      try {
        const configDir = join(tempWorkspace, ".msgcode");
        mkdirSync(configDir, { recursive: true });
        writeFileSync(join(configDir, "config.json"), JSON.stringify({
          "tooling.mode": "explicit",
          "tooling.allow": ["write_file"],
          "tooling.require_confirm": [],
        }));

        const result = await executeTool(
          "write_file",
          { path: externalFile, content: "external-write-ok" },
          {
            workspacePath: tempWorkspace,
            source: "slash-command",
            requestId: randomUUID(),
          }
        );

        expect(result.ok).toBe(true);
        expect(readFileSync(externalFile, "utf-8")).toBe("external-write-ok");
      } finally {
        rmSync(externalFile, { force: true });
      }
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

  describe("Scenario E: bash 工具执行", () => {
    beforeEach(() => {
      // Scenario E: 设置 autonomous 模式并允许 bash
      const configDir = join(tempWorkspace, ".msgcode");
      mkdirSync(configDir, { recursive: true });
      writeFileSync(join(configDir, "config.json"), JSON.stringify({
        "tooling.mode": "autonomous",
        "tooling.allow": ["tts", "asr", "vision", "bash"],
        "tooling.require_confirm": [],
      }));
    });

    test("应该成功执行 bash 命令并返回结果", async () => {
      // 在 macOS 上，echo 命令应该成功
      const result = await executeTool(
        "bash",
        { command: "echo 'hello world'" },
        {
          workspacePath: tempWorkspace,
          source: "slash-command",
          requestId: randomUUID(),
        }
      );

      expect(result.ok).toBe(true);
      expect(result.tool).toBe("bash");
      expect(result.data?.exitCode).toBe(0);
      expect(result.data?.stdout).toContain("hello world");
      expect(result.previewText).toContain("[bash] exitCode=0");
      expect(result.previewText).toContain("[stdout]");
      expect(result.previewText).toContain("[durationMs]");
    });

    test("bash 大输出时 previewText 只保留一个 fullOutputPath 脚注", async () => {
      const result = await executeTool(
        "bash",
        { command: "node -e \"console.log('x'.repeat(200000))\"" },
        {
          workspacePath: tempWorkspace,
          source: "slash-command",
          requestId: randomUUID(),
        }
      );

      expect(result.fullOutputPath).toBeDefined();
      const matches = result.previewText?.match(/\[fullOutputPath\]/g) ?? [];
      expect(matches).toHaveLength(1);
      expect(result.previewText).toContain("[durationMs]");
    });

    test("应该记录 bash 执行到 telemetry", async () => {
      clearToolEvents();

      await executeTool(
        "bash",
        { command: "echo 'test'" },
        {
          workspacePath: tempWorkspace,
          source: "llm-tool-call",
          requestId: randomUUID(),
        }
      );

      const stats = getToolStats(60000);
      expect(stats.totalCalls).toBeGreaterThan(0);
      expect(stats.byTool["bash"]).toBeDefined();
    });

    test("bash 命令失败时应该返回非零退出码", async () => {
      const result = await executeTool(
        "bash",
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
        "bash",
        { command: "   " }, // 只有空格
        {
          workspacePath: tempWorkspace,
          source: "slash-command",
          requestId: randomUUID(),
        }
      );

      // P5.6.13-R1A-EXEC R2: 参数校验返回 TOOL_BAD_ARGS
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("TOOL_BAD_ARGS");
      expect(result.previewText).toContain("[bash] error");
    });
  });

  describe("Scenario E2: read_file SOUL 路径透明性", () => {
    beforeEach(() => {
      const configDir = join(tempWorkspace, ".msgcode");
      mkdirSync(configDir, { recursive: true });
      writeFileSync(join(configDir, "config.json"), JSON.stringify({
        "tooling.mode": "explicit",
        "tooling.allow": ["read_file"],
        "tooling.require_confirm": [],
      }));
    });

    test("path=soul 且主路径不存在时应保留原生失败并提示下一步", async () => {
      const soulDir = join(tempWorkspace, ".msgcode");
      mkdirSync(soulDir, { recursive: true });
      writeFileSync(join(soulDir, "SOUL.md"), "# SOUL\nworkspace soul content");

      const result = await executeTool(
        "read_file",
        { path: "soul" },
        {
          workspacePath: tempWorkspace,
          source: "slash-command",
          requestId: randomUUID(),
        }
      );

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("TOOL_EXEC_FAILED");
      expect(result.error?.message).toContain(`文件不存在：${join(tempWorkspace, "soul")}`);
      expect(result.previewText).toContain("下一步建议：先用 bash 执行 ls、find 或 rg 确认路径");
    });

    test("path=soul 且主路径存在时应优先读取主路径", async () => {
      writeFileSync(join(tempWorkspace, "soul"), "primary soul file");

      const soulDir = join(tempWorkspace, ".msgcode");
      mkdirSync(soulDir, { recursive: true });
      writeFileSync(join(soulDir, "SOUL.md"), "fallback soul file");

      const result = await executeTool(
        "read_file",
        { path: "soul" },
        {
          workspacePath: tempWorkspace,
          source: "slash-command",
          requestId: randomUUID(),
        }
      );

      expect(result.ok).toBe(true);
      const data = result.data as { content: string };
      expect(data.content).toBe("primary soul file");
    });

    test("read_file 读取大文本时应返回预览与 guidance", async () => {
      const targetPath = join(tempWorkspace, "large.txt");
      writeFileSync(targetPath, "A".repeat(80 * 1024), "utf-8");

      const result = await executeTool(
        "read_file",
        { path: targetPath },
        {
          workspacePath: tempWorkspace,
          source: "slash-command",
          requestId: randomUUID(),
        }
      );

      expect(result.ok).toBe(true);
      const data = result.data as {
        content: string;
        path: string;
        truncated?: boolean;
        byteLength?: number;
        guidance?: string;
      };
      expect(data.path).toBe(targetPath);
      expect(data.truncated).toBe(true);
      expect(data.byteLength).toBeGreaterThan(64 * 1024);
      expect(data.guidance).toContain("bash");
      expect(data.content.length).toBeLessThan(80 * 1024);
      expect(result.previewText).toContain("[status] truncated-preview");
      expect(result.previewText).toContain("[durationMs]");
    });

    test("read_file 遇到二进制文件时应返回带下一步建议的失败", async () => {
      const targetPath = join(tempWorkspace, "binary.png");
      writeFileSync(targetPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]));

      const result = await executeTool(
        "read_file",
        { path: targetPath },
        {
          workspacePath: tempWorkspace,
          source: "slash-command",
          requestId: randomUUID(),
        }
      );

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("TOOL_EXEC_FAILED");
      expect(result.error?.message).toContain("PNG 图片");
      expect(result.error?.message).toContain("bash");
      expect(result.previewText).toContain("无法直接按 UTF-8 读取");
    });
  });

  describe("Scenario E3: help_docs CLI 合同探索", () => {
    beforeEach(() => {
      const configDir = join(tempWorkspace, ".msgcode");
      mkdirSync(configDir, { recursive: true });
      writeFileSync(join(configDir, "config.json"), JSON.stringify({
        "tooling.mode": "autonomous",
        "tooling.allow": ["help_docs"],
        "tooling.require_confirm": [],
      }));
    });

    test("help_docs 应返回匹配命令与 preview", async () => {
      const result = await executeTool(
        "help_docs",
        { query: "browser", limit: 2 },
        {
          workspacePath: tempWorkspace,
          source: "llm-tool-call",
          requestId: randomUUID(),
        }
      );

      expect(result.ok).toBe(true);
      const data = result.data as {
        version: string;
        totalCommands: number;
        matchedCommands: number;
        query?: string;
        commands: Array<{ name?: string }>;
      };
      expect(data.version.length).toBeGreaterThan(0);
      expect(data.totalCommands).toBeGreaterThan(0);
      expect(data.matchedCommands).toBeGreaterThan(0);
      expect(data.query).toBe("browser");
      expect(data.commands.length).toBeLessThanOrEqual(2);
      expect(data.commands[0]?.name).toContain("browser");
      expect(result.previewText).toContain("[help_docs]");
      expect(result.previewText).toContain("[durationMs]");
    });
  });

  describe("Scenario E4: write/edit 文件预览下沉", () => {
    beforeEach(() => {
      const configDir = join(tempWorkspace, ".msgcode");
      mkdirSync(configDir, { recursive: true });
      writeFileSync(join(configDir, "config.json"), JSON.stringify({
        "tooling.mode": "autonomous",
        "tooling.allow": ["write_file", "edit_file"],
        "tooling.require_confirm": [],
      }));
    });

    test("write_file 应返回执行层 previewText", async () => {
      const targetPath = join(tempWorkspace, "preview-write.txt");
      const result = await executeTool(
        "write_file",
        { path: targetPath, content: "hello preview" },
        {
          workspacePath: tempWorkspace,
          source: "llm-tool-call",
          requestId: randomUUID(),
        }
      );

      expect(result.ok).toBe(true);
      expect(result.previewText).toContain("[write_file]");
      expect(result.previewText).toContain("文件已写入");
      expect(result.previewText).toContain("[durationMs]");
      expect((result.data as { bytesWritten: number }).bytesWritten).toBeGreaterThan(0);
    });

    test("edit_file 应返回执行层 previewText", async () => {
      const targetPath = join(tempWorkspace, "preview-edit.txt");
      writeFileSync(targetPath, "alpha", "utf-8");
      const result = await executeTool(
        "edit_file",
        { path: targetPath, oldText: "alpha", newText: "beta" },
        {
          workspacePath: tempWorkspace,
          source: "llm-tool-call",
          requestId: randomUUID(),
        }
      );

      expect(result.ok).toBe(true);
      expect(result.previewText).toContain("[edit_file]");
      expect(result.previewText).toContain("文件补丁已应用");
      expect(result.previewText).toContain("[durationMs]");
      expect((result.data as { editsApplied: number }).editsApplied).toBe(1);
    });

    test("策略拒绝和参数校验失败都应返回执行层 previewText", async () => {
      const denied = await executeTool(
        "bash",
        { command: "echo denied" },
        {
          workspacePath: tempWorkspace,
          source: "llm-tool-call",
          requestId: randomUUID(),
        }
      );
      expect(denied.ok).toBe(false);
      expect(denied.previewText).toContain("[bash] error");
      expect(denied.previewText).toContain("tool not allowed");
      expect(denied.previewText).toContain("[durationMs]");

      const badArgs = await executeTool(
        "write_file",
        { path: "" },
        {
          workspacePath: tempWorkspace,
          source: "llm-tool-call",
          requestId: randomUUID(),
        }
      );
      expect(badArgs.ok).toBe(false);
      expect(badArgs.previewText).toContain("[write_file] error");
      expect(badArgs.previewText).toContain("'path' must be a non-empty string");
      expect(badArgs.previewText).toContain("[durationMs]");
    });
  });

  describe("Scenario E5: 飞书工具预览下沉", () => {
    beforeEach(() => {
      const configDir = join(tempWorkspace, ".msgcode");
      mkdirSync(configDir, { recursive: true });
      writeFileSync(join(configDir, "config.json"), JSON.stringify({
        "tooling.mode": "autonomous",
        "tooling.allow": ["feishu_send_file", "feishu_list_members", "feishu_reply_message", "feishu_react_message"],
        "tooling.require_confirm": [],
        "feishu.appId": "workspace-app-id",
        "feishu.appSecret": "workspace-app-secret",
      }));
    });

    test("feishu_list_members / reply / react 应返回执行层 previewText", async () => {
      mock.module("../src/tools/feishu-list-members.js", () => ({
        feishuListMembers: async () => ({
          ok: true,
          chatId: "oc_preview_chat",
          memberIdType: "open_id",
          memberTotal: 2,
          members: [
            { senderId: "ou_owner", name: "won" },
            { senderId: "ou_other", name: "tan" },
          ],
        }),
      }));
      mock.module("../src/tools/feishu-reply-message.js", () => ({
        feishuReplyMessage: async () => ({
          ok: true,
          repliedToMessageId: "om_target",
          messageId: "om_reply",
          replyInThread: true,
          chatId: "oc_preview_chat",
        }),
      }));
      mock.module("../src/tools/feishu-react-message.js", () => ({
        feishuReactMessage: async () => ({
          ok: true,
          messageId: "om_target",
          reactionId: "reaction_preview",
          emojiType: "HEART",
        }),
      }));

      const members = await executeTool(
        "feishu_list_members",
        { chatId: "oc_preview_chat" },
        {
          workspacePath: tempWorkspace,
          source: "llm-tool-call",
          requestId: randomUUID(),
        }
      );
      expect(members.ok).toBe(true);
      expect(members.previewText).toContain("[feishu_list_members]");
      expect(members.previewText).toContain("[memberTotal] 2");
      expect(members.previewText).toContain("[durationMs]");

      const reply = await executeTool(
        "feishu_reply_message",
        { messageId: "om_target", text: "收到", replyInThread: true },
        {
          workspacePath: tempWorkspace,
          source: "llm-tool-call",
          requestId: randomUUID(),
        }
      );
      expect(reply.ok).toBe(true);
      expect(reply.previewText).toContain("[feishu_reply_message]");
      expect(reply.previewText).toContain("消息回复已发送");
      expect(reply.previewText).toContain("[durationMs]");

      const react = await executeTool(
        "feishu_react_message",
        { messageId: "om_target", emoji: "heart" },
        {
          workspacePath: tempWorkspace,
          source: "llm-tool-call",
          requestId: randomUUID(),
        }
      );
      expect(react.ok).toBe(true);
      expect(react.previewText).toContain("[feishu_react_message]");
      expect(react.previewText).toContain("[emojiType] HEART");
      expect(react.previewText).toContain("[durationMs]");
    });
  });

  describe("Scenario F: allowlist 仍生效", () => {
    test("allowlist 中没有的工具应该被拒绝", () => {
      const policy: ToolPolicy = {
        mode: "autonomous",
        allow: ["tts", "asr"], // 不包含 bash
        requireConfirm: [],
      };

      const gate = canExecuteTool(policy, "bash", "llm-tool-call");
      expect(gate.ok).toBe(false);
      expect(gate.code).toBe("TOOL_NOT_ALLOWED");
      expect(gate.message).toContain("tool not allowed: bash");
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
        "tooling.allow": ["tts", "asr"], // 不包含 bash
        "tooling.require_confirm": [],
      }));

      const result = await executeTool(
        "bash",
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

  describe("Scenario G: 默认模式守卫（P5.5 测试期：默认为 autonomous）", () => {
    test("默认配置应该是 autonomous 模式", async () => {
      // 不设置任何配置文件，测试默认值
      const policy = await getToolPolicy(tempWorkspace);

      // P5.5: 测试期默认 autonomous（LLM 自主决策 tool_calls）
      expect(policy.mode).toBe("autonomous");

      // 默认 allowlist 与 workspace 默认配置对齐
      expect(policy.allow).toContain("tts");
      expect(policy.allow).toContain("asr");
      expect(policy.allow).toContain("bash");
      expect(policy.allow).toContain("browser");
      expect(policy.allow).toContain("read_file");
      expect(policy.allow).toContain("write_file");
      expect(policy.allow).toContain("edit_file");
      expect(policy.allow).toContain("help_docs");
    });

    test("autonomous 模式下应该允许 llm-tool-call 来源", async () => {
      // P5.5: 使用默认配置（autonomous）
      const policy = await getToolPolicy(tempWorkspace);
      const gate = canExecuteTool(policy, "tts", "llm-tool-call");

      // autonomous 模式允许 llm-tool-call
      expect(gate.ok).toBe(true);
    });

    test("explicit 模式下应该允许 slash-command 来源", async () => {
      const policy = await getToolPolicy(tempWorkspace);
      const gate = canExecuteTool(policy, "tts", "slash-command");

      expect(gate.ok).toBe(true);
    });
  });
});
