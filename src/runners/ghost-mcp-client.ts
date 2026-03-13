/**
 * ghost-os MCP 最薄客户端。
 *
 * 职责：
 * - 探测 ghost binary
 * - 跑最小 health check（version/status，必要时补 doctor）
 * - 通过 stdio JSON-RPC 调用 `ghost mcp`
 *
 * 非职责：
 * - 不做 desktop.* 映射
 * - 不做流程编排
 * - 不做全局审批层
 */

import { createHash, randomUUID } from "node:crypto";
import { execFile, spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  GHOST_INSTALL_HINT,
  isGhostToolName,
  type GhostToolName,
} from "./ghost-mcp-contract.js";

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 60_000;
const PROBE_CACHE_TTL_MS = 15_000;
const GHOST_ARTIFACT_DIR = join("artifacts", "ghost");

interface ExecFileTextResult {
  stdout: string;
  stderr: string;
}

interface GhostClientDeps {
  execFileText: (
    file: string,
    args: string[],
    options?: { cwd?: string; timeoutMs?: number }
  ) => Promise<ExecFileTextResult>;
  fileExists: (path: string) => boolean;
  spawnProcess: (
    command: string,
    args: string[],
    options: SpawnOptions
  ) => ChildProcess;
}

const runtimeDeps: GhostClientDeps = {
  execFileText: async (file, args, options) => {
    const result = await execFileAsync(file, args, {
      cwd: options?.cwd,
      timeout: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      encoding: "utf8",
      env: process.env,
      maxBuffer: 1024 * 1024,
    });
    return {
      stdout: result.stdout?.trim?.() ?? "",
      stderr: result.stderr?.trim?.() ?? "",
    };
  },
  fileExists: existsSync,
  spawnProcess: spawn,
};

const defaultRuntimeDeps: GhostClientDeps = {
  ...runtimeDeps,
};

export function __setGhostMcpTestDeps(overrides: Partial<GhostClientDeps>): void {
  if (overrides.execFileText) {
    runtimeDeps.execFileText = overrides.execFileText;
  }
  if (overrides.fileExists) {
    runtimeDeps.fileExists = overrides.fileExists;
  }
  if (overrides.spawnProcess) {
    runtimeDeps.spawnProcess = overrides.spawnProcess;
  }
}

export function __resetGhostMcpTestDeps(): void {
  runtimeDeps.execFileText = defaultRuntimeDeps.execFileText;
  runtimeDeps.fileExists = defaultRuntimeDeps.fileExists;
  runtimeDeps.spawnProcess = defaultRuntimeDeps.spawnProcess;
  probeCache = null;
  toolsCache = null;
}

export function __clearGhostProbeCache(): void {
  probeCache = null;
  toolsCache = null;
}

export interface GhostProbeResult {
  binaryPath: string;
  version: string;
  statusOutput: string;
  statusSummary: string;
}

export interface GhostToolContentItem {
  type: string;
  text?: string;
  mimeType?: string;
  artifactPath?: string;
}

export interface GhostToolRunResult {
  rawResult: Record<string, unknown>;
  content: GhostToolContentItem[];
  structuredContent?: Record<string, unknown>;
  textContent?: string;
  isError: boolean;
  binaryPath: string;
  version: string;
  statusSummary: string;
  stderr: string;
  artifacts?: Array<{ kind: "ghost" | "log"; path: string }>;
}

export interface GhostMcpToolDefinition {
  name: GhostToolName;
  description: string;
  inputSchema: {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

class GhostMcpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GhostMcpError";
  }
}

let probeCache:
  | {
      timestamp: number;
      result: GhostProbeResult;
    }
  | null = null;

let toolsCache:
  | {
      workspacePath: string;
      timestamp: number;
      tools: GhostMcpToolDefinition[];
    }
  | null = null;

function buildInstallMessage(extra?: string): string {
  return extra ? `${extra}\n${GHOST_INSTALL_HINT}` : GHOST_INSTALL_HINT;
}

async function resolveGhostBinaryPath(): Promise<string> {
  const envOverride = process.env.MSGCODE_GHOST_PATH?.trim();
  if (envOverride) {
    if (!runtimeDeps.fileExists(envOverride)) {
      throw new GhostMcpError(buildInstallMessage(`MSGCODE_GHOST_PATH does not exist: ${envOverride}`));
    }
    return envOverride;
  }

  const fixedPaths = [
    "/opt/homebrew/bin/ghost",
    "/usr/local/bin/ghost",
  ];
  for (const candidate of fixedPaths) {
    if (runtimeDeps.fileExists(candidate)) {
      return candidate;
    }
  }

  try {
    const found = await runtimeDeps.execFileText("which", ["ghost"], { timeoutMs: 5_000 });
    const binaryPath = found.stdout.trim();
    if (binaryPath) {
      return binaryPath;
    }
  } catch {
    // ignore and fall through to install hint
  }

  throw new GhostMcpError(buildInstallMessage());
}

function parseStatusSummary(statusOutput: string): string {
  const lines = statusOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const summary = lines.find((line) => line.startsWith("Status:"));
  return summary ?? "Status: unknown";
}

async function runGhostHealthCheck(binaryPath: string): Promise<GhostProbeResult> {
  const version = await runtimeDeps.execFileText(binaryPath, ["version"], { timeoutMs: 10_000 });
  const status = await runtimeDeps.execFileText(binaryPath, ["status"], { timeoutMs: 15_000 });
  const statusSummary = parseStatusSummary(status.stdout);

  if (!/Status:\s*Ready/i.test(status.stdout)) {
    let doctorOutput = "";
    try {
      const doctor = await runtimeDeps.execFileText(binaryPath, ["doctor"], { timeoutMs: 20_000 });
      doctorOutput = [doctor.stdout, doctor.stderr].filter(Boolean).join("\n").trim();
    } catch (error) {
      doctorOutput = error instanceof Error ? error.message : String(error);
    }

    const parts = [
      `ghost status not ready`,
      `[binary] ${binaryPath}`,
      `[version] ${version.stdout || "<unknown>"}`,
      "[status]",
      status.stdout || "<empty>",
    ];
    if (doctorOutput) {
      parts.push("[doctor]");
      parts.push(doctorOutput);
    }
    throw new GhostMcpError(parts.join("\n"));
  }

  return {
    binaryPath,
    version: version.stdout || "Ghost OS <unknown>",
    statusOutput: status.stdout,
    statusSummary,
  };
}

async function probeGhostBinary(): Promise<GhostProbeResult> {
  if (probeCache && Date.now() - probeCache.timestamp < PROBE_CACHE_TTL_MS) {
    return probeCache.result;
  }

  const binaryPath = await resolveGhostBinaryPath();
  const result = await runGhostHealthCheck(binaryPath);
  probeCache = {
    timestamp: Date.now(),
    result,
  };
  return result;
}

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: {
    code?: number;
    message?: string;
  };
}

function attachStdoutProtocol(
  proc: ChildProcess,
  pending: Map<string | number, { resolve: (message: JsonRpcMessage) => void; reject: (error: Error) => void }>
): void {
  let buffer = "";
  proc.stdout?.on("data", (chunk: Buffer | string) => {
    buffer += chunk.toString();
    while (true) {
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) break;
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) continue;

      let message: JsonRpcMessage;
      try {
        message = JSON.parse(line) as JsonRpcMessage;
      } catch {
        continue;
      }

      if (message.id === undefined || !pending.has(message.id)) {
        continue;
      }

      const waiter = pending.get(message.id)!;
      pending.delete(message.id);

      if (message.error?.message) {
        waiter.reject(new GhostMcpError(message.error.message));
        continue;
      }

      waiter.resolve(message);
    }
  });
}

async function persistGhostImageArtifact(params: {
  workspacePath: string;
  toolName: GhostToolName;
  mimeType: string;
  base64Data: string;
}): Promise<string> {
  const ext = params.mimeType === "image/jpeg" ? "jpg" : "png";
  const dir = join(params.workspacePath, GHOST_ARTIFACT_DIR);
  await mkdir(dir, { recursive: true });
  const digest = createHash("sha1").update(params.base64Data).digest("hex").slice(0, 12);
  const filePath = join(dir, `${params.toolName}-${digest}-${randomUUID()}.${ext}`);
  await writeFile(filePath, Buffer.from(params.base64Data, "base64"));
  return filePath;
}

function normalizeTextContent(content: GhostToolContentItem[]): {
  structuredContent?: Record<string, unknown>;
  textContent?: string;
} {
  const textItem = content.find((item) => item.type === "text" && item.text);
  if (!textItem?.text) {
    return {};
  }

  const text = textItem.text.trim();
  if (!text) {
    return {};
  }

  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return {
        structuredContent: parsed,
        textContent: text,
      };
    }
  } catch {
    // plain text caption/index, keep as-is
  }

  return {
    textContent: text,
  };
}

async function withGhostMcpSession<T>(params: {
  binaryPath: string;
  workspacePath: string;
  timeoutMs: number;
  run: (session: {
    send: (id: string | number, method: string, payload?: Record<string, unknown>) => Promise<JsonRpcMessage>;
  }) => Promise<T>;
}): Promise<{ value: T; stderr: string }> {
  const proc = runtimeDeps.spawnProcess(params.binaryPath, ["mcp"], {
    cwd: params.workspacePath,
    env: { ...process.env, PWD: params.workspacePath },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stderr = "";
  proc.stderr?.on("data", (chunk: Buffer | string) => {
    stderr += chunk.toString();
  });

  const pending = new Map<string | number, { resolve: (message: JsonRpcMessage) => void; reject: (error: Error) => void }>();
  attachStdoutProtocol(proc, pending);
  proc.on("error", (error) => {
    for (const waiter of pending.values()) {
      waiter.reject(new GhostMcpError(error.message));
    }
    pending.clear();
  });

  const register = (id: string | number): Promise<JsonRpcMessage> =>
    new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });

  const send = async (
    id: string | number,
    method: string,
    payload?: Record<string, unknown>
  ): Promise<JsonRpcMessage> => {
    const waiter = register(id);
    proc.stdin?.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      ...(payload ? { params: payload } : {}),
    })}\n`);
    return await waiter;
  };

  const timeoutHandle = setTimeout(() => {
    proc.kill("SIGTERM");
    setTimeout(() => proc.kill("SIGKILL"), 1000).unref();
  }, params.timeoutMs);

  const closePromise = new Promise<void>((resolveClose) => {
    proc.on("close", () => resolveClose());
  });

  try {
    await send("init", "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "msgcode",
        version: "2.3.0",
      },
    });

    proc.stdin?.write(`${JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {},
    })}\n`);

    return {
      value: await params.run({ send }),
      stderr: stderr.trim(),
    };
  } catch (error) {
    if (error instanceof GhostMcpError) {
      throw error;
    }
    if (error instanceof Error && /timed out/i.test(error.message)) {
      throw new GhostMcpError("ghost mcp timed out");
    }
    throw new GhostMcpError(error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timeoutHandle);
    proc.kill("SIGTERM");
    await closePromise;
  }
}

export async function listGhostMcpTools(options: {
  workspacePath: string;
  timeoutMs?: number;
}): Promise<GhostMcpToolDefinition[]> {
  if (
    toolsCache
    && toolsCache.workspacePath === options.workspacePath
    && Date.now() - toolsCache.timestamp < PROBE_CACHE_TTL_MS
  ) {
    return toolsCache.tools;
  }

  const probe = await probeGhostBinary();
  const listed = await withGhostMcpSession({
    binaryPath: probe.binaryPath,
    workspacePath: options.workspacePath,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    run: async ({ send }) => {
      const toolsList = await send("list", "tools/list", {});
      const rawTools = Array.isArray(toolsList.result?.tools) ? toolsList.result?.tools : [];
      return rawTools
        .map((item) => {
          const tool = item as Record<string, unknown>;
          const name = typeof tool.name === "string" ? tool.name : "";
          if (!isGhostToolName(name)) {
            return null;
          }
          return {
            name,
            description: typeof tool.description === "string" ? tool.description : "",
            inputSchema: (tool.inputSchema as GhostMcpToolDefinition["inputSchema"]) ?? {},
          } satisfies GhostMcpToolDefinition;
        })
        .filter((item): item is GhostMcpToolDefinition => item !== null);
    },
  });

  toolsCache = {
    workspacePath: options.workspacePath,
    timestamp: Date.now(),
    tools: listed.value,
  };
  return listed.value;
}

export async function runGhostMcpTool(options: {
  workspacePath: string;
  toolName: GhostToolName;
  args: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<GhostToolRunResult> {
  const probe = await probeGhostBinary();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const raw = await withGhostMcpSession({
    binaryPath: probe.binaryPath,
    workspacePath: options.workspacePath,
    timeoutMs,
    run: async ({ send }) => {
      const toolsList = await send("list", "tools/list", {});
      const toolDefs = Array.isArray(toolsList.result?.tools) ? toolsList.result?.tools : [];
      const toolExists = toolDefs.some((item) => {
        const tool = item as Record<string, unknown>;
        return tool?.name === options.toolName;
      });
      if (!toolExists) {
        throw new GhostMcpError(`ghost mcp tool not recognized: ${options.toolName}`);
      }

      const toolCall = await send("call", "tools/call", {
        name: options.toolName,
        arguments: options.args,
      });

      return (toolCall.result ?? {}) as Record<string, unknown>;
    },
  });

  const rawResult = raw.value;
  const rawContent = Array.isArray(rawResult.content) ? rawResult.content : [];
  const content: GhostToolContentItem[] = [];
  const artifacts: Array<{ kind: "ghost" | "log"; path: string }> = [];

  for (const item of rawContent) {
    const entry = item as Record<string, unknown>;
    const type = typeof entry.type === "string" ? entry.type : "";
    if (!type) continue;

    if (
      type === "image"
      && typeof entry.data === "string"
      && typeof entry.mimeType === "string"
    ) {
      const artifactPath = await persistGhostImageArtifact({
        workspacePath: options.workspacePath,
        toolName: options.toolName,
        mimeType: entry.mimeType,
        base64Data: entry.data,
      });
      content.push({
        type,
        mimeType: entry.mimeType,
        artifactPath,
      });
      artifacts.push({ kind: "ghost", path: artifactPath });
      continue;
    }

    content.push({
      type,
      text: typeof entry.text === "string" ? entry.text : undefined,
      mimeType: typeof entry.mimeType === "string" ? entry.mimeType : undefined,
    });
  }

  const normalized = normalizeTextContent(content);
  const structuredContent = normalized.structuredContent;
  const textContent = normalized.textContent;
  const structuredError = typeof structuredContent?.error === "string" ? structuredContent.error : undefined;
  const isError = rawResult.isError === true || Boolean(structuredError);

  if (isError) {
    const message = structuredError || textContent || "ghost mcp tool call failed";
    throw new GhostMcpError(message);
  }

  return {
    rawResult,
    content,
    structuredContent,
    textContent,
    isError,
    binaryPath: probe.binaryPath,
    version: probe.version,
    statusSummary: probe.statusSummary,
    stderr: raw.stderr,
    artifacts: artifacts.length > 0 ? artifacts : undefined,
  };
}
