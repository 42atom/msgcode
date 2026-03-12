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
        "tooling.mode": "autonomous",
        "tooling.allow": ["bash", "read_file"],
        "tooling.require_confirm": [],
      },
      null,
      2,
    ),
    "utf-8",
  );
  return workspacePath;
}

async function createFeishuSendToolEnabledWorkspace(root: string): Promise<string> {
  const workspacePath = join(root, "workspace");
  await mkdir(join(workspacePath, ".msgcode"), { recursive: true });
  await writeFile(
    join(workspacePath, ".msgcode", "config.json"),
    JSON.stringify(
      {
        "tooling.mode": "autonomous",
        "tooling.allow": ["feishu_send_file", "bash", "read_file"],
        "tooling.require_confirm": [],
      },
      null,
      2,
    ),
    "utf-8",
  );
  return workspacePath;
}

async function createBrowserToolEnabledWorkspace(root: string): Promise<string> {
  const workspacePath = join(root, "workspace");
  await mkdir(join(workspacePath, ".msgcode"), { recursive: true });
  await writeFile(
    join(workspacePath, ".msgcode", "config.json"),
    JSON.stringify(
      {
        "tooling.mode": "autonomous",
        "tooling.allow": ["browser", "bash", "read_file"],
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
      expect(observedSystemPrompt).not.toContain("查记忆用 mem");
      expect(observedSystemPrompt).toContain("禁止把 file、memory、thread、todo、cron、gen、banana-pro-image-gen 当作工具名");
      expect(observedSystemPrompt).toContain("只有拿到本轮真实工具回执后");
      expect(observedSystemPrompt).toContain("不要编造旧错误、旧附件结果或旧视觉结论");
      expect(observedSystemPrompt).toContain("[技能系统]");
      expect(observedSystemPrompt).toContain("全局 skills 索引 JSON（只读）");
      expect(observedSystemPrompt).toContain('"source": "global-single-source"');
      expect(observedSystemPrompt).toContain('"skills": [');
      expect(observedSystemPrompt).toContain('"id": "file"');
      expect(observedSystemPrompt).toContain("全局技能：");
      expect(observedSystemPrompt).not.toContain("工作区技能：");
      expect(observedSystemPrompt).not.toContain("workspace-only-skill");
      expect(observedSystemPrompt).toContain("~/.config/msgcode/skills/<id>/SKILL.md");
      expect(observedSystemPrompt).toContain("把 SKILL.md 当成能力说明书 / 接口文档");
      expect(observedSystemPrompt).toContain("不要自造 wrapper，不要猜 main.sh");
      expect(observedSystemPrompt).toContain("skill 是说明书，不是默认执行入口");
      expect(observedSystemPrompt).toContain("只有当前能力没有原生工具，或需要额外 CLI / 脚本合同知识时");
      expect(observedSystemPrompt).toContain("只有 help_docs 仍不足以覆盖具体能力边界或操作步骤时");
      expect(observedSystemPrompt).toContain("不要复述上一轮失败");
      expect(observedSystemPrompt).toContain("缺少当前附件或路径");
      expect(observedSystemPrompt).not.toContain("<workspace>/.msgcode/skills");
      expect(observedSystemPrompt).toContain("[原生工具优先]");
      expect(observedSystemPrompt).toContain("如果当前能力已经作为原生工具暴露，就优先调用原生工具，不要先走 bash 包一层 CLI。");
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
      expect(observedSystemPrompt).toContain("~/.config/msgcode/skills/<id>/SKILL.md");
      expect(observedSystemPrompt).toContain("把 SKILL.md 当成能力说明书 / 接口文档");
      expect(observedSystemPrompt).toContain("不要自造 wrapper，不要猜 main.sh");
      expect(observedSystemPrompt).toContain("只有拿到本轮真实工具回执后");
      expect(observedSystemPrompt).toContain("缺少当前附件或路径");
      expect(observedSystemPrompt).not.toContain("<workspace>/.msgcode/skills");
    } finally {
      globalThis.fetch = originalFetch;
      await rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it("应只在 feishu_send_file 暴露时注入文件发送原生工具提示", async () => {
    const originalFetch = globalThis.fetch;
    const tmpRoot = await mkdtemp(join(tmpdir(), "msgcode-r9-t2-feishu-send-hint-"));
    let observedSystemPrompt = "";
    let callCount = 0;

    try {
      const workspacePath = await createFeishuSendToolEnabledWorkspace(tmpRoot);

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
                      id: "call_feishu_send_hint_1",
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
        prompt: "把 smoke-a.txt 发回飞书群",
        workspacePath,
        timeoutMs: 10_000,
        backendRuntime: localOpenAiRuntime,
      });

      expect(result.answer).toContain("ok");
      expect(observedSystemPrompt).toContain("[原生工具优先]");
      expect(observedSystemPrompt).toContain("如果当前能力已经作为原生工具暴露，就优先调用原生工具，不要先走 bash 包一层 CLI。");
      expect(observedSystemPrompt).toContain("发送文件回飞书群时，唯一正式发送入口是 feishu_send_file。");
      expect(observedSystemPrompt).toContain("不要先用 bash 调 msgcode CLI 假装发送文件；只有 feishu_send_file 成功后，才可回答“已发送”。");
    } finally {
      globalThis.fetch = originalFetch;
      await rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it("应向模型注入当前 workspace 与 config 绝对路径，禁止虚构工作区路径", async () => {
    const originalFetch = globalThis.fetch;
    const tmpRoot = await mkdtemp(join(tmpdir(), "msgcode-r9-t2-workspace-hint-"));
    let observedSystemPrompt = "";
    let callCount = 0;

    try {
      const workspacePath = await createToolEnabledWorkspace(tmpRoot);
      const expectedConfigPath = join(workspacePath, ".msgcode", "config.json");

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
                      id: "call_workspace_hint_1",
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
        prompt: "读取当前 workspace config",
        workspacePath,
        timeoutMs: 10_000,
        backendRuntime: localOpenAiRuntime,
      });

      expect(result.answer).toContain("ok");
      expect(observedSystemPrompt).toContain("[当前工作区]");
      expect(observedSystemPrompt).toContain(`当前工作区绝对路径：${workspacePath}`);
      expect(observedSystemPrompt).toContain(`当前 workspace config 绝对路径：${expectedConfigPath}`);
      expect(observedSystemPrompt).toContain("只能使用上面这个绝对路径");
      expect(observedSystemPrompt).toContain("禁止猜测、拼接或虚构其他工作区绝对路径");
      expect(observedSystemPrompt).not.toContain("vela-workspace");
    } finally {
      globalThis.fetch = originalFetch;
      await rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it("应向模型注入 Patchright 与共享工作 Chrome 路径口径", async () => {
    const originalFetch = globalThis.fetch;
    const originalWorkspaceRoot = process.env.WORKSPACE_ROOT;
    const tmpRoot = await mkdtemp(join(tmpdir(), "msgcode-r9-t2-browser-hint-"));
    let observedSystemPrompt = "";
    let chatCallCount = 0;

    try {
      process.env.WORKSPACE_ROOT = tmpRoot;
      const workspacePath = await createBrowserToolEnabledWorkspace(tmpRoot);

      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith("http://127.0.0.1:1234")) {
          chatCallCount += 1;
          if (chatCallCount === 1) {
            observedSystemPrompt = getSystemPromptFromRequest(init);
            return asJsonResponse({
              choices: [
                {
                  message: {
                    role: "assistant",
                    content: "",
                    tool_calls: [
                      {
                        id: "call_browser_hint_1",
                        type: "function",
                        function: {
                          name: "browser",
                          arguments: JSON.stringify({ operation: "health" }),
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
        }
        throw new Error(`unexpected fetch url: ${url}`);
      }) as typeof fetch;

      const result = await runLmStudioToolLoop({
        baseUrl: "http://127.0.0.1:1234",
        model: "test-model",
        prompt: "打开 example.com",
        workspacePath,
        timeoutMs: 10_000,
        backendRuntime: localOpenAiRuntime,
      });

      expect(result.answer).toContain("ok");
      expect(observedSystemPrompt).toContain("[当前浏览器底座]");
      expect(observedSystemPrompt).toContain("唯一正式浏览器通道：browser 工具（Patchright + Chrome-as-State）。");
      expect(observedSystemPrompt).toContain("唯一正式连接方式：Patchright connectOverCDP。");
      expect(observedSystemPrompt).toContain("共享工作 Chrome profilesRoot：");
      expect(observedSystemPrompt).toContain("默认工作 Chrome root：");
      expect(observedSystemPrompt).toContain("不要使用 agent-browser 作为正式浏览器通道");
      expect(observedSystemPrompt).toContain("patchright-browser/SKILL.md");
      expect(observedSystemPrompt).toContain("--remote-debugging-port=9222");
      expect(observedSystemPrompt).toContain("浏览器真实任务（打开网页、读标题、点击、截图）默认优先 browser 工具。");
      expect(observedSystemPrompt).toContain("只有在排障、查 root/instances/tabs 状态、或确认 CLI 合同时，才转向 msgcode browser CLI。");
      expect(observedSystemPrompt).toContain("instances.stop 和 tabs.list 必须传真实 instanceId");
      expect(observedSystemPrompt).toContain("instanceId 只能来自 instances.launch、instances.list、tabs.open 等真实返回值");
      expect(observedSystemPrompt).toContain("tabId 只能来自 tabs.open、tabs.list、snapshot、text 的真实返回值");
    } finally {
      globalThis.fetch = originalFetch;
      if (originalWorkspaceRoot === undefined) {
        delete process.env.WORKSPACE_ROOT;
      } else {
        process.env.WORKSPACE_ROOT = originalWorkspaceRoot;
      }
      await rm(tmpRoot, { recursive: true, force: true });
    }
  });
});
