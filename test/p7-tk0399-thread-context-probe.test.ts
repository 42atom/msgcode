import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { appendWindow } from "../src/session-window.js";
import { saveSummary } from "../src/summary.js";
import { probeContext } from "../src/probe/probes/context.js";
import { formatReport, runSingleProbe } from "../src/probe/index.js";

describe("tk0399: thread context token breakdown probe", () => {
  let workspacePath = "";
  const chatId = "chat-tk0399";
  const taskId = "tk0399";
  const envBackup: Record<string, string | undefined> = {};
  const envKeys = [
    "AGENT_CONTEXT_WINDOW_TOKENS",
    "AGENT_RESERVED_OUTPUT_TOKENS",
    "AGENT_CHARS_PER_TOKEN",
    "AGENT_BACKEND",
    "AGENT_MODEL",
  ] as const;

  beforeEach(async () => {
    workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "msgcode-tk0399-"));
    await fs.mkdir(path.join(workspacePath, ".msgcode", "workstates"), { recursive: true });
    await fs.writeFile(
      path.join(workspacePath, ".msgcode", "config.json"),
      JSON.stringify({ "agent.conflict_mode": "assisted" }, null, 2),
      "utf-8",
    );
    await fs.writeFile(
      path.join(workspacePath, ".msgcode", "workstates", `${taskId}.md`),
      "先确认端口冲突，再继续启动本地服务。",
      "utf-8",
    );
    await appendWindow(workspacePath, chatId, { role: "user", content: "帮我排查服务起不来" });
    await appendWindow(workspacePath, chatId, { role: "assistant", content: "我先看日志和端口占用。" });
    await saveSummary(workspacePath, chatId, {
      goal: ["把本地服务拉起来"],
      constraints: ["不要误杀用户正在用的服务"],
      decisions: ["先确认端口占用再动手"],
      openItems: [],
      toolFacts: ["日志目录在 .msgcode/log"],
    });

    for (const key of envKeys) {
      envBackup[key] = process.env[key];
    }
    process.env.AGENT_CONTEXT_WINDOW_TOKENS = "4096";
    process.env.AGENT_RESERVED_OUTPUT_TOKENS = "1024";
    process.env.AGENT_CHARS_PER_TOKEN = "2";
    process.env.AGENT_BACKEND = "agent-backend";
    process.env.AGENT_MODEL = "huihui-glm-4.7-flash-abliterated-mlx";
  });

  afterEach(async () => {
    for (const key of envKeys) {
      if (envBackup[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = envBackup[key];
      }
    }
    await fs.rm(workspacePath, { recursive: true, force: true });
  });

  it("应输出固定五段，并对 unavailable 段显式标记", async () => {
    const result = await probeContext({
      workspacePath,
      chatId,
      taskId,
      prompt: "继续处理，但高影响动作前先确认。",
      systemOverride: "你是测试系统提示。",
      agentProvider: "agent-backend",
      model: "huihui-glm-4.7-flash-abliterated-mlx",
    });

    expect(result.status).toBe("pass");
    const details = result.details as {
      totalTokens: number;
      segments: Array<Record<string, unknown>>;
      conflictMode: string;
    };
    expect(details.totalTokens).toBeGreaterThan(0);
    expect(details.conflictMode).toBe("assisted");

    const keys = details.segments.map((segment) => segment.key);
    expect(keys).toEqual([
      "system_prompt",
      "tool_definitions",
      "project_context",
      "history_dialogue",
      "current_input",
    ]);

    const unavailable = details.segments.find((segment) => segment.key === "tool_definitions");
    expect(unavailable?.status).toBe("unavailable");

    const ratioSum = details.segments
      .filter((segment) => segment.status === "ok")
      .reduce((sum, segment) => sum + Number(segment.ratio || 0), 0);
    expect(ratioSum).toBeGreaterThan(0.99);
    expect(ratioSum).toBeLessThanOrEqual(1.01);
  });

  it("text/json formatter 应保留 breakdown 细节，并忽略 skip 诊断", async () => {
    const report = await runSingleProbe("context", {
      workspacePath,
      chatId,
      taskId,
      prompt: "继续处理，但高影响动作前先确认。",
      systemOverride: "你是测试系统提示。",
      agentProvider: "agent-backend",
    });

    const textOutput = formatReport(report, { format: "text" }, "msgcode probe context", Date.now());
    expect(textOutput).toContain("[system_prompt");
    expect(textOutput).toContain("[tool_definitions unavailable]");
    expect(textOutput).toContain("totalTokens:");

    const jsonOutput = formatReport(report, { format: "json" }, "msgcode probe context", Date.now());
    const envelope = JSON.parse(jsonOutput) as {
      errors: Array<{ code: string }>;
      data: { categories: { context: { probes: Array<{ details: { segments: Array<{ key: string; status: string }> } }> } } };
    };
    expect(envelope.errors).toEqual([]);
    expect(envelope.data.categories.context.probes[0]?.details.segments[1]?.key).toBe("tool_definitions");
    expect(envelope.data.categories.context.probes[0]?.details.segments[1]?.status).toBe("unavailable");
  });
});
