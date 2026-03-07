/**
 * msgcode: P5.7-R9-T2 Skills 单源化回归锁（global-only）
 *
 * 目标：
 * - Tool Loop 只读取 ~/.config/msgcode/skills/index.json
 * - 忽略 <workspace>/.msgcode/skills/index.json
 */

import { describe, it, expect } from "bun:test";
import { runLmStudioToolLoop } from "../src/lmstudio.js";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

type ChatCompletionRequest = {
  messages?: Array<{
    role?: string;
    content?: string;
  }>;
};

function asJsonResponse(payload: ChatCompletionPayload): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function createToolEnabledWorkspace(root: string): Promise<string> {
  const workspacePath = join(root, "workspace");
  await mkdir(join(workspacePath, ".msgcode"), { recursive: true });
  await writeFile(
    join(workspacePath, ".msgcode", "config.json"),
    JSON.stringify(
      {
        "pi.enabled": true,
        "tooling.mode": "autonomous",
        "tooling.allow": ["bash", "read_file", "write_file", "edit_file"],
        "tooling.require_confirm": [],
      },
      null,
      2,
    ),
    "utf-8",
  );
  return workspacePath;
}

function parseChatRequestBody(init?: RequestInit): ChatCompletionRequest {
  if (!init || typeof init.body !== "string") {
    return {};
  }
  try {
    return JSON.parse(init.body) as ChatCompletionRequest;
  } catch {
    return {};
  }
}

function getSystemPromptFromRequest(init?: RequestInit): string {
  const body = parseChatRequestBody(init);
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const systemMessage = messages.find((m) => m.role === "system");
  return typeof systemMessage?.content === "string" ? systemMessage.content : "";
}

describe("P5.7-R9-T2: Skills global-only single source", () => {
  it("应忽略 workspace skills 索引，只保留全局 skills 注入口径", async () => {
    const originalFetch = globalThis.fetch;
    const tmpRoot = await mkdtemp(join(tmpdir(), "msgcode-r9-t2-global-skill-"));
    let observedSystemPrompt = "";
    let callCount = 0;

    try {
      const workspacePath = await createToolEnabledWorkspace(tmpRoot);

      await mkdir(join(workspacePath, ".msgcode", "skills"), { recursive: true });
      await writeFile(
        join(workspacePath, ".msgcode", "skills", "index.json"),
        JSON.stringify(
          {
            version: 1,
            skills: [{ id: "workspace-only-skill" }],
          },
          null,
          2,
        ),
        "utf-8",
      );

      globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
        callCount += 1;

        if (callCount === 1) {
          observedSystemPrompt = getSystemPromptFromRequest(init);
          return asJsonResponse({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: "",
                  tool_calls: [
                    {
                      id: "call_skill_source_1",
                      type: "function",
                      function: {
                        name: "bash",
                        arguments: JSON.stringify({ command: "pwd" }),
                      },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
          });
        }

        return asJsonResponse({
          choices: [
            {
              message: {
                role: "assistant",
                content: "ok",
              },
              finish_reason: "stop",
            },
          ],
        });
      }) as typeof fetch;

      const result = await runLmStudioToolLoop({
        baseUrl: "http://127.0.0.1:1234",
        model: "test-model",
        prompt: "测试技能索引来源",
        workspacePath,
        timeoutMs: 10_000,
        backendRuntime: localOpenAiRuntime,
      });

      expect(result.answer).toContain("ok");
      expect(observedSystemPrompt).toContain("[当前可用工具索引]");
      expect(observedSystemPrompt).toContain("- read_file:");
      expect(observedSystemPrompt).toContain("- bash:");
      expect(observedSystemPrompt).toContain("skill 名不是工具名");
      expect(observedSystemPrompt).toContain("查记忆用 mem");
      expect(observedSystemPrompt).toContain("禁止把 file、memory、thread、todo、cron、media、gen、banana-pro-image-gen 当作工具名");
      expect(observedSystemPrompt).toContain("[技能系统]");
      expect(observedSystemPrompt).toContain("全局 skills 索引 JSON（只读）");
      expect(observedSystemPrompt).toContain('"source": "global-single-source"');
      expect(observedSystemPrompt).toContain('"skills": [');
      expect(observedSystemPrompt).toContain('"id": "file"');
      expect(observedSystemPrompt).toContain("全局技能：");
      expect(observedSystemPrompt).not.toContain("工作区技能：");
      expect(observedSystemPrompt).not.toContain("workspace-only-skill");
      expect(observedSystemPrompt).toContain("~/.config/msgcode/skills/<id>/main.sh");
      expect(observedSystemPrompt).not.toContain("<workspace>/.msgcode/skills");
    } finally {
      globalThis.fetch = originalFetch;
      await rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it("技能调用路径文案必须锁定为全局 skills 目录", async () => {
    const originalFetch = globalThis.fetch;
    const tmpRoot = await mkdtemp(join(tmpdir(), "msgcode-r9-t2-no-global-"));
    let observedSystemPrompt = "";
    let callCount = 0;

    try {
      const workspacePath = await createToolEnabledWorkspace(tmpRoot);

      await mkdir(join(workspacePath, ".msgcode", "skills"), { recursive: true });
      await writeFile(
        join(workspacePath, ".msgcode", "skills", "index.json"),
        JSON.stringify(
          {
            version: 1,
            skills: [{ id: "workspace-fallback-skill" }],
          },
          null,
          2,
        ),
        "utf-8",
      );

      globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
        callCount += 1;

        if (callCount === 1) {
          observedSystemPrompt = getSystemPromptFromRequest(init);
          return asJsonResponse({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: "",
                  tool_calls: [
                    {
                      id: "call_no_global_1",
                      type: "function",
                      function: {
                        name: "bash",
                        arguments: JSON.stringify({ command: "pwd" }),
                      },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
          });
        }

        return asJsonResponse({
          choices: [
            {
              message: {
                role: "assistant",
                content: "done",
              },
              finish_reason: "stop",
            },
          ],
        });
      }) as typeof fetch;

      const result = await runLmStudioToolLoop({
        baseUrl: "http://127.0.0.1:1234",
        model: "test-model",
        prompt: "测试技能路径注入",
        workspacePath,
        timeoutMs: 10_000,
        backendRuntime: localOpenAiRuntime,
      });

      expect(result.answer).toContain("done");
      expect(observedSystemPrompt).not.toContain("工作区技能：");
      expect(observedSystemPrompt).not.toContain("workspace-fallback-skill");
      expect(observedSystemPrompt).toContain("~/.config/msgcode/skills/<id>/main.sh");
      expect(observedSystemPrompt).not.toContain("<workspace>/.msgcode/skills");
    } finally {
      globalThis.fetch = originalFetch;
      await rm(tmpRoot, { recursive: true, force: true });
    }
  });
});
