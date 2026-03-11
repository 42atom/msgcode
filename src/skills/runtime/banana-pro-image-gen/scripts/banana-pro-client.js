#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

function scrubBase64(text) {
  if (!text) return text;
  let out = String(text);
  out = out.replace(
    /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g,
    "[base64_image_redacted]"
  );
  out = out.replace(/[A-Za-z0-9+/=]{200,}/g, "[base64_redacted]");
  return out;
}

function safeLog(...args) {
  const sanitized = args.map((arg) =>
    typeof arg === "string" ? scrubBase64(arg) : arg
  );
  console.log(...sanitized);
}

function safeError(...args) {
  const sanitized = args.map((arg) =>
    typeof arg === "string" ? scrubBase64(arg) : arg
  );
  console.error(...sanitized);
}

// 中文注释：向上查找指定文件
function findFileUp(startDir, filename) {
  let dir = path.resolve(startDir);
  while (true) {
    const candidate = path.join(dir, filename);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// 中文注释：加载项目根 .env 并注入环境变量
function loadEnv() {
  const envPath = findFileUp(process.cwd(), ".env");
  if (envPath) {
    const raw = fs.readFileSync(envPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      const value = trimmed.slice(idx + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
    return path.dirname(envPath);
  }
  return process.cwd();
}

// 中文注释：解析命令行参数
function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        args[key] = true;
      } else {
        if (args[key]) {
          const existing = Array.isArray(args[key]) ? args[key] : [args[key]];
          existing.push(next);
          args[key] = existing;
        } else {
          args[key] = next;
        }
        i += 1;
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}

// 中文注释：输出用法并退出
function usageAndExit() {
  const msg = [
    "Usage:",
    "  node scripts/banana-pro-client.js generate --prompt \"a cute cat\" [--model gemini-3-pro-image-preview] [--aspectRatio 1:1] [--imageSize 2K]",
    "  node scripts/banana-pro-client.js edit --prompt \"make it rainy\" --input /path/to/image.png",
    "  node scripts/banana-pro-client.js describe --input /path/to/image.png [--prompt \"Describe it\"]",
    "Options:",
    "  --prompt <text>        Prompt for generate/edit/describe",
    "  --input <path>         Input image path (repeatable)",
    "  --model <name>         Model name (default: gemini-3-pro-image-preview)",
    "  --aspectRatio <ratio>  1:1|3:4|4:3|9:16|16:9 (generate/edit only)",
    "  --imageSize <size>     1K|2K|4K (generate/edit only)",
    "  --out <path>           Output file path (generate/edit only)",
    "  --timeout <ms>         Request timeout in milliseconds (default: 120000)",
    "  --retries <n>          Retry count on failure (default: 2)",
    "  --retryDelay <ms>      Base retry delay in milliseconds (default: 2000)",
  ].join("\n");
  safeError(msg);
  process.exit(1);
}

// 中文注释：生成安全文件名片段
function toSlug(input) {
  const safe = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return safe || "image";
}

// 中文注释：生成时间戳
function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// 中文注释：根据扩展名推断 MIME
function detectMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "application/octet-stream";
}

// 中文注释：读取图片并转为 base64
function readImageAsBase64(filePath) {
  const data = fs.readFileSync(filePath);
  return data.toString("base64");
}

// 中文注释：构建 Gemini 请求 parts
function buildParts(prompt, inputs) {
  const parts = [{ text: prompt }];
  for (const img of inputs) {
    parts.push({
      inlineData: {
        mimeType: img.mimeType,
        data: img.data,
      },
    });
  }
  return parts;
}

// 中文注释：调用 Gemini 生成接口
async function callGemini(apiKey, model, requestBody, timeoutMs) {
  if (typeof fetch !== "function") {
    throw new Error("Global fetch is not available. Use Node.js 18+.");
  }
  const controller = new AbortController();
  const effectiveTimeoutMs = typeof timeoutMs === "number" ? timeoutMs : 120000;
  const timeoutId = setTimeout(() => controller.abort(), effectiveTimeoutMs);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
  } catch (err) {
    if (err && err.name === "AbortError") {
      throw new Error(`Request timed out after ${effectiveTimeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errorText}`);
  }
  return response.json();
}

// 中文注释：简单的退避重试封装
async function callWithRetry(fn, retries, retryDelay) {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries) throw err;
      const delay = retryDelay * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
      attempt += 1;
    }
  }
}

// 中文注释：主入口
async function main() {
  const projectRoot = loadEnv();
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  if (!command) usageAndExit();

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    safeError("Error: GEMINI_API_KEY is required (set in .env or environment)");
    process.exit(1);
  }

  const model = args.model || "gemini-3-pro-image-preview";
  const prompt = args.prompt || "";
  const aspectRatio = args.aspectRatio || undefined;
  const imageSize = args.imageSize || undefined;
  const timeoutMs = args.timeout ? Number(args.timeout) : 120000;
  const retries = args.retries ? Number(args.retries) : 2;
  const retryDelay = args.retryDelay ? Number(args.retryDelay) : 2000;

  const inputPaths = Array.isArray(args.input)
    ? args.input
    : args.input
      ? [args.input]
      : [];

  const inputs = inputPaths.map((p) => ({
    path: p,
    mimeType: detectMimeType(p),
    data: readImageAsBase64(p),
  }));

  if ((command === "generate" || command === "edit") && !prompt) {
    safeError("Error: --prompt is required for generate/edit");
    process.exit(1);
  }

  if ((command === "edit" || command === "describe") && inputs.length === 0) {
    safeError("Error: --input is required for edit/describe");
    process.exit(1);
  }

  if (command === "describe") {
    const requestBody = {
      contents: [{ parts: buildParts(prompt || "Describe this image in detail.", inputs) }],
      generationConfig: { responseModalities: ["TEXT"] },
    };

    const data = await callWithRetry(
      () => callGemini(apiKey, model, requestBody, timeoutMs),
      retries,
      retryDelay
    );
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const text = parts.map((p) => p.text || "").join("").trim();
    if (!text) {
      throw new Error("No description in Gemini response");
    }
    safeLog(text);
    return;
  }

  const requestBody = {
    contents: [{ parts: buildParts(prompt, inputs) }],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      ...(aspectRatio || imageSize
        ? { imageConfig: { ...(aspectRatio ? { aspectRatio } : {}), ...(imageSize ? { imageSize } : {}) } }
        : {}),
    },
  };

  const data = await callWithRetry(
    () => callGemini(apiKey, model, requestBody, timeoutMs),
    retries,
    retryDelay
  );
  const parts = data?.candidates?.[0]?.content?.parts || [];
  let imagePart = null;
  let description = "";

  for (const part of parts) {
    if (part.inlineData) imagePart = part.inlineData;
    if (part.text) description += part.text;
  }

  if (!imagePart || !imagePart.data) {
    throw new Error("No image data in Gemini response");
  }

  const outputDir = path.join(projectRoot, "AIDOCS/banana-images");
  fs.mkdirSync(outputDir, { recursive: true });

  const baseName = args.out
    ? path.resolve(args.out)
    : path.join(outputDir, `banana-pro-${timestamp()}-${toSlug(prompt)}.png`);

  const buffer = Buffer.from(imagePart.data, "base64");
  fs.writeFileSync(baseName, buffer);

  safeLog(`Saved: ${baseName}`);
  safeLog(`MIME: ${imagePart.mimeType || "image/png"}`);
  if (description.trim()) safeLog(`Notes: ${description.trim()}`);
}

main().catch((err) => {
  safeError(err instanceof Error ? err.message : err);
  process.exit(1);
});
