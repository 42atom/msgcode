/**
 * model-reviewer: 串行对比多个 LM Studio 模型在同一任务上的输出表现。
 *
 * 目标：
 * - 固定同一张图、同一条 prompt、同一组请求参数
 * - 对比 content / reasoning_content / finish_reason / usage / 耗时 / 错误
 * - 将原始结果落盘到 AIDOCS/tmp，便于后续人工核验
 *
 * 当前聚焦：vision / image_url 任务。
 * 约束：只做串行评测，不做并行，避免同时加载多个大模型导致内存爆。
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";

type CompareResult = {
  model: string;
  ok: boolean;
  durationMs: number;
  finishReason: string;
  contentChars: number;
  reasoningChars: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  error: string;
  responsePath: string;
  contentPath: string | null;
  reasoningPath: string | null;
};

type ChatCompletionResponse = {
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      role?: string;
      content?: unknown;
      reasoning_content?: unknown;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

const DEFAULT_BASE_URL = process.env.LMSTUDIO_BASE_URL || "http://127.0.0.1:1234";
const DEFAULT_MODELS = [
  "huihui-glm-4.6v-flash-abliterated-mlx",
  "qwen/qwen3.5-35b-a3b",
];
const DEFAULT_PROMPT = "把图里的表格文字尽量忠实提出来，保持原有结构，不要只做摘要。";
const DEFAULT_MAX_TOKENS = 2048;
const DEFAULT_TIMEOUT_MS = 180_000;

function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "").replace(/\/v1$/, "");
}

function sanitizeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function getArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function printUsage(): void {
  console.log(`Usage:
  bun scripts/model-reviewer/main.ts --image <abs-path> [options]

Options:
  --models <m1,m2>       逗号分隔模型列表
  --prompt <text>        提示词
  --base-url <url>       LM Studio base URL
  --max-tokens <n>       输出 token 上限（默认 2048）
  --timeout-ms <n>       请求超时（默认 180000）
  --out-dir <dir>        输出目录（默认 AIDOCS/tmp/model-reviewer-<ts>）
  --auto-load            由脚本负责 load / unload 模型
`);
}

async function ensureModelLoaded(baseUrl: string, model: string): Promise<void> {
  const body = JSON.stringify({ model });
  const endpoints = [
    `${baseUrl}/api/v1/models/load`,
    `${baseUrl}/api/v0/model/load`,
  ];

  for (const url of endpoints) {
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (resp.ok) return;
    } catch {
      // best effort
    }
  }
}

async function unloadModel(baseUrl: string, model: string): Promise<void> {
  const endpoints = [
    { method: "POST", url: `${baseUrl}/api/v1/models/unload`, body: JSON.stringify({ model }) },
    { method: "POST", url: `${baseUrl}/api/v0/model/unload`, body: JSON.stringify({ model }) },
    { method: "DELETE", url: `${baseUrl}/api/v1/models/${encodeURIComponent(model)}`, body: undefined },
  ];

  for (const endpoint of endpoints) {
    try {
      const resp = await fetch(endpoint.url, {
        method: endpoint.method,
        headers: endpoint.body ? { "Content-Type": "application/json" } : undefined,
        body: endpoint.body,
      });
      if (resp.ok) return;
    } catch {
      // best effort
    }
  }
}

async function runOne(params: {
  baseUrl: string;
  model: string;
  imagePath: string;
  prompt: string;
  maxTokens: number;
  timeoutMs: number;
  outDir: string;
}): Promise<CompareResult> {
  const startedAt = Date.now();
  const imageBuffer = await readFile(params.imagePath);
  const imageBase64 = imageBuffer.toString("base64");
  const ext = params.imagePath.toLowerCase().split(".").pop() || "png";
  const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";

  const body = {
    model: params.model,
    temperature: 0,
    max_tokens: params.maxTokens,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: params.prompt },
          { type: "image_url", image_url: { url: `data:${mime};base64,${imageBase64}` } },
        ],
      },
    ],
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs);
  const safeModel = sanitizeName(params.model);
  const responsePath = join(params.outDir, `${safeModel}.response.json`);
  const contentPath = join(params.outDir, `${safeModel}.content.txt`);
  const reasoningPath = join(params.outDir, `${safeModel}.reasoning.txt`);

  try {
    const resp = await fetch(`${params.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const rawText = await resp.text();
    if (!resp.ok) {
      await writeFile(responsePath, rawText, "utf-8");
      return {
        model: params.model,
        ok: false,
        durationMs: Date.now() - startedAt,
        finishReason: "",
        contentChars: 0,
        reasoningChars: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        error: `HTTP ${resp.status}: ${rawText.slice(0, 300)}`,
        responsePath,
        contentPath: null,
        reasoningPath: null,
      };
    }

    const json = JSON.parse(rawText) as ChatCompletionResponse;
    await writeFile(responsePath, JSON.stringify(json, null, 2), "utf-8");

    const choice = json.choices?.[0];
    const content = typeof choice?.message?.content === "string" ? choice.message.content : "";
    const reasoning =
      typeof choice?.message?.reasoning_content === "string" ? choice.message.reasoning_content : "";

    if (content) {
      await writeFile(contentPath, content, "utf-8");
    }
    if (reasoning) {
      await writeFile(reasoningPath, reasoning, "utf-8");
    }

    return {
      model: params.model,
      ok: true,
      durationMs: Date.now() - startedAt,
      finishReason: choice?.finish_reason || "",
      contentChars: content.length,
      reasoningChars: reasoning.length,
      promptTokens: json.usage?.prompt_tokens || 0,
      completionTokens: json.usage?.completion_tokens || 0,
      totalTokens: json.usage?.total_tokens || 0,
      error: "",
      responsePath,
      contentPath: content ? contentPath : null,
      reasoningPath: reasoning ? reasoningPath : null,
    };
  } catch (error) {
    return {
      model: params.model,
      ok: false,
      durationMs: Date.now() - startedAt,
      finishReason: "",
      contentChars: 0,
      reasoningChars: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      error: error instanceof Error ? error.message : String(error),
      responsePath,
      contentPath: null,
      reasoningPath: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

function printSummary(results: CompareResult[]): void {
  const rows = results.map((result) => ({
    model: result.model,
    ok: result.ok ? "yes" : "no",
    ms: result.durationMs,
    finish: result.finishReason || "-",
    content: result.contentChars,
    reasoning: result.reasoningChars,
    promptTok: result.promptTokens,
    compTok: result.completionTokens,
    totalTok: result.totalTokens,
    error: result.error || "-",
  }));

  console.table(rows);
}

async function main(): Promise<void> {
  if (hasFlag("--help")) {
    printUsage();
    return;
  }

  const imagePath = getArg("--image");
  if (!imagePath) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const resolvedImagePath = resolve(imagePath);
  if (!existsSync(resolvedImagePath)) {
    throw new Error(`图片不存在: ${resolvedImagePath}`);
  }

  const baseUrl = normalizeBaseUrl(getArg("--base-url") || DEFAULT_BASE_URL);
  const models = (getArg("--models") || DEFAULT_MODELS.join(","))
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const prompt = getArg("--prompt") || DEFAULT_PROMPT;
  const maxTokens = Number(getArg("--max-tokens") || DEFAULT_MAX_TOKENS);
  const timeoutMs = Number(getArg("--timeout-ms") || DEFAULT_TIMEOUT_MS);
  const outDir =
    resolve(
      getArg("--out-dir") ||
        join(process.cwd(), "AIDOCS", "tmp", `model-reviewer-${Date.now()}`)
    );
  const shouldManageModels = hasFlag("--auto-load");

  await mkdir(outDir, { recursive: true });

  const meta = {
    imagePath: resolvedImagePath,
    imageName: basename(resolvedImagePath),
    baseUrl,
    models,
    prompt,
    maxTokens,
    timeoutMs,
    startedAt: new Date().toISOString(),
  };
  await writeFile(join(outDir, "meta.json"), JSON.stringify(meta, null, 2), "utf-8");

  console.log("Model Reviewer（串行）");
  console.log("=".repeat(80));
  console.log("image:", resolvedImagePath);
  console.log("baseUrl:", baseUrl);
  console.log("models:", models.join(", "));
  console.log("maxTokens:", maxTokens);
  console.log("outDir:", outDir);
  console.log("");

  const results: CompareResult[] = [];

  for (const model of models) {
    console.log(`>>> ${model}`);
    if (shouldManageModels) {
      await ensureModelLoaded(baseUrl, model);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 2000));
    }
    const result = await runOne({
      baseUrl,
      model,
      imagePath: resolvedImagePath,
      prompt,
      maxTokens,
      timeoutMs,
      outDir,
    });
    results.push(result);
    console.log(
      `ok=${result.ok} finish=${result.finishReason || "-"} ms=${result.durationMs} content=${result.contentChars} reasoning=${result.reasoningChars}`
    );
    if (result.error) {
      console.log(`error=${result.error}`);
    }
    console.log("");
    if (shouldManageModels) {
      await unloadModel(baseUrl, model);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 1500));
    }
  }

  await writeFile(join(outDir, "summary.json"), JSON.stringify(results, null, 2), "utf-8");
  printSummary(results);
  console.log(`\n结果已写入: ${outDir}`);
}

main().catch((error) => {
  console.error("错误:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
