import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLmStudioToolLoop } from "../src/lmstudio.js";
import { __resetBashRunnerTestDeps, __setBashRunnerTestDeps } from "../src/runners/bash-runner.js";

const localOpenAiRuntime = {
  id: "local-openai" as const,
  baseUrl: "http://127.0.0.1:1234",
  model: "test-model",
  timeoutMs: 10_000,
  nativeApiEnabled: false,
};

type ChatCompletionPayload = {
  choices: Array<{
    message: {
      role?: string;
      content?: string;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason?: string;
  }>;
};

function asJsonResponse(payload: ChatCompletionPayload): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function createToolEnabledWorkspace(): Promise<string> {
  const workspacePath = await mkdtemp(join(tmpdir(), "msgcode-tk0266-negative-smoke-"));
  await mkdir(join(workspacePath, ".msgcode"), { recursive: true });
  await writeFile(
    join(workspacePath, ".msgcode", "config.json"),
    JSON.stringify({
      "tooling.mode": "autonomous",
      "tooling.allow": ["bash", "read_file"],
      "tooling.require_confirm": [],
    }, null, 2),
    "utf-8",
  );
  return workspacePath;
}

describe("tk0266: negative smoke real error pass criteria", () => {
  beforeEach(() => {
    __setBashRunnerTestDeps({ resolveManagedBashPath: () => "/bin/bash" });
  });

  afterEach(() => {
    __resetBashRunnerTestDeps();
  });

  it("read_file 缺文件时应把 ENOENT 回灌给模型，而不是入口拦截吞掉", async () => {
    const originalFetch = globalThis.fetch;
    const workspacePath = await createToolEnabledWorkspace();
    let callCount = 0;
    const capturedBodies: Array<Record<string, unknown>> = [];

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      callCount += 1;
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      capturedBodies.push(body);

      if (callCount === 1) {
        return asJsonResponse({
          choices: [{
            message: {
              role: "assistant",
              content: "",
              tool_calls: [{
                id: "call_missing_file",
                type: "function",
                function: {
                  name: "read_file",
                  arguments: JSON.stringify({ path: ".msgcode/missing.txt" }),
                },
              }],
            },
            finish_reason: "tool_calls",
          }],
        });
      }

      return asJsonResponse({
        choices: [{
          message: {
            role: "assistant",
            content: "已收到缺文件结果，错误码是 ENOENT。",
          },
          finish_reason: "stop",
        }],
      });
    }) as typeof fetch;

    try {
      const result = await runLmStudioToolLoop({
        baseUrl: "http://127.0.0.1:1234",
        model: "test-model",
        prompt: "读取不存在的文件",
        workspacePath,
        timeoutMs: 10_000,
        backendRuntime: localOpenAiRuntime,
      });

      expect(callCount).toBe(2);
      expect(result.answer).toContain("ENOENT");
      expect(result.actionJournal).toHaveLength(1);
      expect(result.actionJournal[0]?.tool).toBe("read_file");
      expect(result.actionJournal[0]?.ok).toBe(false);
      expect(result.actionJournal[0]?.errorCode).toBe("ENOENT");

      const secondRequestMessages = capturedBodies[1]?.messages as Array<Record<string, unknown>>;
      const lastMessage = secondRequestMessages[secondRequestMessages.length - 1];
      expect(lastMessage.role).toBe("tool");
      expect(String(lastMessage.content)).toContain("[errorCode] ENOENT");
      expect(String(lastMessage.content)).toContain("文件不存在");
    } finally {
      globalThis.fetch = originalFetch;
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  it("bash 缺命令时应把 127 和 command not found 回灌给模型，而不是只报系统拦截", async () => {
    const originalFetch = globalThis.fetch;
    const workspacePath = await createToolEnabledWorkspace();
    let callCount = 0;
    const capturedBodies: Array<Record<string, unknown>> = [];

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      callCount += 1;
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      capturedBodies.push(body);

      if (callCount === 1) {
        return asJsonResponse({
          choices: [{
            message: {
              role: "assistant",
              content: "",
              tool_calls: [{
                id: "call_missing_command",
                type: "function",
                function: {
                  name: "bash",
                  arguments: JSON.stringify({ command: "nonexistent-msgcode-command" }),
                },
              }],
            },
            finish_reason: "tool_calls",
          }],
        });
      }

      return asJsonResponse({
        choices: [{
          message: {
            role: "assistant",
            content: "命令不存在，已收到 127 和 command not found。",
          },
          finish_reason: "stop",
        }],
      });
    }) as typeof fetch;

    try {
      const result = await runLmStudioToolLoop({
        baseUrl: "http://127.0.0.1:1234",
        model: "test-model",
        prompt: "执行一个不存在的命令",
        workspacePath,
        timeoutMs: 10_000,
        backendRuntime: localOpenAiRuntime,
      });

      expect(callCount).toBe(2);
      expect(result.answer).toContain("127");
      expect(result.actionJournal).toHaveLength(1);
      expect(result.actionJournal[0]?.tool).toBe("bash");
      expect(result.actionJournal[0]?.ok).toBe(false);
      expect(result.actionJournal[0]?.errorCode).toBe("TOOL_EXEC_FAILED");
      expect(result.actionJournal[0]?.exitCode).toBe(127);
      expect(result.actionJournal[0]?.stderrTail).toContain("command not found");

      const secondRequestMessages = capturedBodies[1]?.messages as Array<Record<string, unknown>>;
      const lastMessage = secondRequestMessages[secondRequestMessages.length - 1];
      expect(lastMessage.role).toBe("tool");
      expect(String(lastMessage.content)).toContain("[exitCode] 127");
      expect(String(lastMessage.content)).toContain("command not found");
    } finally {
      globalThis.fetch = originalFetch;
      await rm(workspacePath, { recursive: true, force: true });
    }
  });
});
