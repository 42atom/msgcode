import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLmStudioToolLoop } from "../src/lmstudio.js";

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

describe("tk0309: workspace pack skill discovery prompt slice", () => {
  const originalFetch = globalThis.fetch;
  const originalHome = process.env.HOME;
  const tempRoots: string[] = [];

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("应把当前工作区已安装 pack skill 提示进 system prompt", async () => {
    const tmpRoot = await mkdtemp(join(tmpdir(), "msgcode-tk0309-"));
    tempRoots.push(tmpRoot);
    const homeRoot = join(tmpRoot, "home");
    process.env.HOME = homeRoot;
    await mkdir(join(homeRoot, ".config", "msgcode", "skills"), { recursive: true });
    await writeFile(
      join(homeRoot, ".config", "msgcode", "skills", "index.json"),
      JSON.stringify({ version: 1, source: "global-single-source", skills: [{ id: "file" }] }, null, 2),
      "utf8",
    );

    const workspacePath = await createToolEnabledWorkspace(tmpRoot);
    const skillPath = join(workspacePath, ".msgcode", "packs", "user", "company-finance", "skills", "finance-index", "SKILL.md");
    await mkdir(join(skillPath, ".."), { recursive: true });
    await writeFile(skillPath, "# finance\n", "utf8");
    await writeFile(
      join(workspacePath, ".msgcode", "packs.json"),
      JSON.stringify(
        {
          builtin: [],
          user: [
            {
              id: "company-finance",
              name: "公司财务包",
              version: "0.1.0",
              enabled: true,
              skills: [".msgcode/packs/user/company-finance/skills/finance-index/SKILL.md"],
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    let observedSystemPrompt = "";
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      observedSystemPrompt = getSystemPromptFromRequest(init);
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
      prompt: "测试工作区能力包 skill 提示",
      workspacePath,
      timeoutMs: 10_000,
      backendRuntime: localOpenAiRuntime,
    });

    expect(result.answer).toContain("ok");
    expect(observedSystemPrompt).toContain("[技能系统]");
    expect(observedSystemPrompt).toContain("[工作区已安装能力包]");
    expect(observedSystemPrompt).toContain("公司财务包 (company-finance)");
    expect(observedSystemPrompt).toContain(skillPath);
    expect(observedSystemPrompt).toContain("不同步到全局 skills 索引");
    expect(observedSystemPrompt).toContain("只有当前任务确实涉及对应能力包时");
  });

  it("缺少 packs.json 或缺少技能文件时不应注入工作区能力包提示", async () => {
    const tmpRoot = await mkdtemp(join(tmpdir(), "msgcode-tk0309-empty-"));
    tempRoots.push(tmpRoot);
    const homeRoot = join(tmpRoot, "home");
    process.env.HOME = homeRoot;
    await mkdir(join(homeRoot, ".config", "msgcode", "skills"), { recursive: true });
    await writeFile(
      join(homeRoot, ".config", "msgcode", "skills", "index.json"),
      JSON.stringify({ version: 1, source: "global-single-source", skills: [{ id: "file" }] }, null, 2),
      "utf8",
    );

    const workspacePath = await createToolEnabledWorkspace(tmpRoot);
    let observedSystemPrompt = "";
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      observedSystemPrompt = getSystemPromptFromRequest(init);
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

    await runLmStudioToolLoop({
      baseUrl: "http://127.0.0.1:1234",
      model: "test-model",
      prompt: "测试空工作区能力包 skill 提示",
      workspacePath,
      timeoutMs: 10_000,
      backendRuntime: localOpenAiRuntime,
    });

    expect(observedSystemPrompt).not.toContain("[工作区已安装能力包]");
  });
});
