/**
 * msgcode: 配置域命令（backend/local/api/tmux/model/policy）
 *
 * 目标：
 * - `/backend` 只切执行主分支
 * - `/local /api /tmux` 只改各自分支预设
 * - `/text-model /vision-model /tts-model /embedding-model` 只改当前分支模型覆盖
 * - `/model` 退化为状态页与旧命令兼容入口
 */

import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";
import type { CommandHandlerOptions, CommandResult } from "./cmd-types.js";
import {
  getBackendLane,
  getBranchModel,
  getPolicyMode,
  getTmuxClient,
  loadWorkspaceConfig,
  saveWorkspaceConfig,
  setBranchModel,
  setPolicyMode,
  setRuntimeKind,
  setTmuxClient,
  type BackendLane,
  type ModelLane,
  type ModelSlot,
  type TmuxClient,
} from "../config/workspace.js";
import {
  normalizeLocalAgentBackendId,
  type LocalAgentBackendId,
} from "../local-backend/registry.js";
import { resolveCommandRoute } from "./workspace-resolver.js";

type ApiProviderId = "minimax" | "deepseek" | "openai";
type ActiveAgentProvider = "agent-backend" | ApiProviderId;

const DEFAULT_LOCAL_APP: LocalAgentBackendId = "omlx";
const DEFAULT_API_PROVIDER: ApiProviderId = "minimax";
const DEFAULT_TMUX_CLIENT: TmuxClient = "codex";
const API_PROVIDER_ENV_KEY = "MSGCODE_API_PROVIDER";

function getConfigDir(): string {
  return (process.env.MSGCODE_CONFIG_DIR || "").trim() || join(os.homedir(), ".config", "msgcode");
}

function getUserEnvPath(): string {
  return join(getConfigDir(), ".env");
}

function readEnvLines(filePath: string): string[] {
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, "utf8");
    return raw.split(/\r?\n/);
  } catch {
    return [];
  }
}

function writeEnvLines(filePath: string, lines: string[]): void {
  const dir = getConfigDir();
  fs.mkdirSync(dir, { recursive: true });
  const content = lines.join("\n").replace(/\n+$/, "\n");
  const tmp = `${filePath}.tmp.${Date.now()}`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, filePath);
}

function upsertEnvLine(lines: string[], key: string, value: string): string[] {
  const prefix = `${key}=`;
  let replaced = false;
  const next = lines.map((line) => {
    if (line.startsWith(prefix) && !replaced) {
      replaced = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!replaced) next.push(`${key}=${value}`);
  return next;
}

function normalizeRequestedApiProvider(input: string): ApiProviderId | null {
  const value = input.trim().toLowerCase();
  if (value === "minimax" || value === "deepseek" || value === "openai") {
    return value;
  }
  return null;
}

function normalizeRequestedLocalBackend(input: string): LocalAgentBackendId | null {
  const value = input.trim().toLowerCase();
  if (value === "lmstudio" || value === "omlx") {
    return normalizeLocalAgentBackendId(value);
  }
  return null;
}

function normalizeRequestedBackendLane(input: string): BackendLane | null {
  const value = input.trim().toLowerCase();
  if (value === "local" || value === "api" || value === "tmux") {
    return value;
  }
  return null;
}

function normalizeRequestedTmuxClient(input: string): TmuxClient | null {
  const value = input.trim().toLowerCase();
  if (value === "codex" || value === "claude-code") {
    return value;
  }
  return null;
}

function normalizeModelOverrideInput(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  if (trimmed.toLowerCase() === "auto") return "";
  return trimmed;
}

function isSupportedTtsModelOverride(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "" || normalized === "qwen";
}

function getActiveAgentProvider(): ActiveAgentProvider {
  const requestedApi = normalizeRequestedApiProvider(process.env.AGENT_BACKEND || "");
  if (requestedApi) {
    return requestedApi;
  }
  return "agent-backend";
}

function setActiveAgentProvider(provider: ActiveAgentProvider): void {
  const envPath = getUserEnvPath();
  let lines = readEnvLines(envPath);
  lines = upsertEnvLine(lines, "AGENT_BACKEND", provider);
  writeEnvLines(envPath, lines);
  process.env.AGENT_BACKEND = provider;
}

function getConfiguredLocalApp(): LocalAgentBackendId {
  const configured = normalizeRequestedLocalBackend(process.env.LOCAL_AGENT_BACKEND || "");
  return configured || DEFAULT_LOCAL_APP;
}

function setConfiguredLocalApp(localApp: LocalAgentBackendId): void {
  const envPath = getUserEnvPath();
  let lines = readEnvLines(envPath);
  lines = upsertEnvLine(lines, "LOCAL_AGENT_BACKEND", localApp);
  writeEnvLines(envPath, lines);
  process.env.LOCAL_AGENT_BACKEND = localApp;
}

function getConfiguredApiProvider(): ApiProviderId {
  const configured = normalizeRequestedApiProvider(process.env[API_PROVIDER_ENV_KEY] || "");
  if (configured) {
    return configured;
  }
  const active = normalizeRequestedApiProvider(process.env.AGENT_BACKEND || "");
  if (active) {
    return active;
  }
  return DEFAULT_API_PROVIDER;
}

function setConfiguredApiProvider(provider: ApiProviderId): void {
  const envPath = getUserEnvPath();
  let lines = readEnvLines(envPath);
  lines = upsertEnvLine(lines, API_PROVIDER_ENV_KEY, provider);
  writeEnvLines(envPath, lines);
  process.env[API_PROVIDER_ENV_KEY] = provider;
}

function formatBranchModelValue(backend: BackendLane, model: string | undefined): string {
  if (backend === "tmux") return "n/a (tmux)";
  return model || "auto";
}

function formatVisionModelValue(backend: BackendLane, model: string | undefined): string {
  if (backend === "tmux") return "n/a (tmux)";
  if (backend === "api") return `local-only (${model || "auto"})`;
  return model || "auto";
}

function getTmuxClientLabel(client: TmuxClient | "none"): TmuxClient {
  return client === "none" ? DEFAULT_TMUX_CLIENT : client;
}

function renderModelStatusMessage(params: {
  backend: BackendLane;
  localApp: LocalAgentBackendId;
  apiProvider: ApiProviderId;
  tmuxClient: TmuxClient;
  textModel?: string;
  visionModel?: string;
  ttsModel?: string;
  embeddingModel?: string;
}): string {
  return [
    "/model status",
    "",
    `backend: ${params.backend}`,
    `local-app: ${params.localApp}`,
    `api-provider: ${params.apiProvider}`,
    `tmux-client: ${params.tmuxClient}`,
    "",
    `text-model: ${formatBranchModelValue(params.backend, params.textModel)}`,
    `vision-model: ${formatVisionModelValue(params.backend, params.visionModel)}`,
    `tts-model: ${formatBranchModelValue(params.backend, params.ttsModel)}`,
    `embedding-model: ${formatBranchModelValue(params.backend, params.embeddingModel)}`,
  ].join("\n");
}

function renderModelFieldMessage(slot: ModelSlot, backend: BackendLane, value?: string): string {
  if (slot === "vision") {
    return `${slot}-model: ${formatVisionModelValue(backend, value)}`;
  }
  return `${slot}-model: ${formatBranchModelValue(backend, value)}`;
}

function renderLocalStatusMessage(localApp: LocalAgentBackendId): string {
  return `local-app: ${localApp}`;
}

function renderApiStatusMessage(apiProvider: ApiProviderId): string {
  return `api-provider: ${apiProvider}`;
}

function renderTmuxStatusMessage(tmuxClient: TmuxClient): string {
  return `tmux-client: ${tmuxClient}`;
}

function renderBackendStatusMessage(backend: BackendLane): string {
  return `backend: ${backend}`;
}

function resolveBoundWorkspace(chatId: string): { projectDir: string; label?: string } | null {
  const resolved = resolveCommandRoute(chatId);
  const entry = resolved?.route;
  if (!entry?.workspacePath) {
    return null;
  }
  return {
    projectDir: entry.workspacePath,
    label: entry.label,
  };
}

async function buildModelStatus(projectDir: string): Promise<string> {
  const backend = await getBackendLane(projectDir);
  const localApp = getConfiguredLocalApp();
  const apiProvider = getConfiguredApiProvider();
  const tmuxClient = getTmuxClientLabel(await getTmuxClient(projectDir));

  const lane = backend === "tmux" ? null : backend;
  const textModel = lane ? await getBranchModel(projectDir, lane, "text") : undefined;
  const visionModel = backend === "tmux"
    ? undefined
    : await getBranchModel(projectDir, "local", "vision");
  const ttsModel = lane ? await getBranchModel(projectDir, lane, "tts") : undefined;
  const embeddingModel = lane ? await getBranchModel(projectDir, lane, "embedding") : undefined;

  return renderModelStatusMessage({
    backend,
    localApp,
    apiProvider,
    tmuxClient,
    textModel,
    visionModel,
    ttsModel,
    embeddingModel,
  });
}

async function ensureTmuxAllowed(projectDir: string): Promise<CommandResult | null> {
  const currentMode = await getPolicyMode(projectDir);
  if (currentMode === "local-only") {
    return {
      success: false,
      message: `当前策略模式为 local-only，不允许切到 tmux 分支（需要外网访问）。\n\n` +
        `请先执行以下命令之一：\n` +
        `1. /policy on\n` +
        `2. /policy egress-allowed\n` +
        `3. /policy full`,
    };
  }
  return null;
}

async function handleModelFieldCommand(
  slot: ModelSlot,
  options: CommandHandlerOptions
): Promise<CommandResult> {
  const { chatId, args } = options;
  const bound = resolveBoundWorkspace(chatId);
  if (!bound) {
    return {
      success: false,
      message: `本群未绑定任何工作目录\n\n请先使用 /bind <dir> [client] 绑定工作空间`,
    };
  }

  const backend = await getBackendLane(bound.projectDir);
  if (args.length === 0) {
    if (backend === "tmux") {
      return { success: true, message: renderModelFieldMessage(slot, backend) };
    }
    const currentValue = await getBranchModel(
      bound.projectDir,
      slot === "vision" ? "local" : backend,
      slot
    );
    return {
      success: true,
      message: renderModelFieldMessage(slot, backend, currentValue),
    };
  }

  if (backend === "tmux") {
    return {
      success: false,
      message: `tmux 模式不支持本地/API 模型覆盖，请先切回 /backend local 或 /backend api`,
    };
  }

  const normalized = normalizeModelOverrideInput(args[0] ?? "");
  if (!normalized && (args[0] ?? "").trim() === "") {
    return {
      success: false,
      message: `无效的 ${slot}-model：请输入模型 ID 或 auto`,
    };
  }

  if (slot === "tts" && !isSupportedTtsModelOverride(normalized)) {
    return {
      success: false,
      message: `当前 tts-model 仅支持 qwen | auto`,
    };
  }

  const effectiveLane: ModelLane = slot === "vision" ? "local" : backend;
  await setBranchModel(bound.projectDir, effectiveLane, slot, normalized);
  const savedValue = await getBranchModel(bound.projectDir, effectiveLane, slot);

  return {
    success: true,
    message: [
      `已更新 ${slot}-model`,
      "",
      `backend: ${backend}`,
      ...(slot === "vision" && backend === "api"
        ? ["说明：视觉能力固定走本地模型，图片不会上传到 API provider。"]
        : []),
      renderModelFieldMessage(slot, backend, savedValue),
    ].join("\n"),
  };
}

export async function handleBackendCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  const { chatId, args } = options;
  const bound = resolveBoundWorkspace(chatId);
  if (!bound) {
    return {
      success: false,
      message: `本群未绑定任何工作目录\n\n请先使用 /bind <dir> [client] 绑定工作空间`,
    };
  }

  if (args.length === 0) {
    return {
      success: true,
      message: renderBackendStatusMessage(await getBackendLane(bound.projectDir)),
    };
  }

  const target = normalizeRequestedBackendLane(args[0] ?? "");
  if (!target) {
    return {
      success: false,
      message: `无效的 backend：${args[0]}\n\n可用值：local | api | tmux`,
    };
  }

  if (target === "tmux") {
    const blocked = await ensureTmuxAllowed(bound.projectDir);
    if (blocked) return blocked;
    await setRuntimeKind(bound.projectDir, "tmux");
    const currentClient = getTmuxClientLabel(await getTmuxClient(bound.projectDir));
    await setTmuxClient(bound.projectDir, currentClient);
    return {
      success: true,
      message: [
        `已切换 backend`,
        "",
        renderBackendStatusMessage("tmux"),
        renderTmuxStatusMessage(currentClient),
      ].join("\n"),
    };
  }

  await setRuntimeKind(bound.projectDir, "agent");

  if (target === "local") {
    const localApp = getConfiguredLocalApp();
    setConfiguredLocalApp(localApp);
    setActiveAgentProvider("agent-backend");
    return {
      success: true,
      message: [
        `已切换 backend`,
        "",
        renderBackendStatusMessage("local"),
        renderLocalStatusMessage(localApp),
      ].join("\n"),
    };
  }

  const apiProvider = getConfiguredApiProvider();
  setConfiguredApiProvider(apiProvider);
  setActiveAgentProvider(apiProvider);
  return {
    success: true,
    message: [
      `已切换 backend`,
      "",
      renderBackendStatusMessage("api"),
      renderApiStatusMessage(apiProvider),
    ].join("\n"),
  };
}

export async function handleLocalCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  const { chatId, args } = options;
  const bound = resolveBoundWorkspace(chatId);
  if (!bound) {
    return {
      success: false,
      message: `本群未绑定任何工作目录\n\n请先使用 /bind <dir> [client] 绑定工作空间`,
    };
  }

  if (args.length === 0) {
    return {
      success: true,
      message: renderLocalStatusMessage(getConfiguredLocalApp()),
    };
  }

  const requested = normalizeRequestedLocalBackend(args[0] ?? "");
  if (!requested) {
    return {
      success: false,
      message: `无效的 local-app：${args[0]}\n\n可用值：omlx | lmstudio`,
    };
  }

  setConfiguredLocalApp(requested);
  const backend = await getBackendLane(bound.projectDir);
  if (backend === "local") {
    setActiveAgentProvider("agent-backend");
  }

  return {
    success: true,
    message: [
      `已更新 local-app`,
      "",
      renderLocalStatusMessage(requested),
      `backend: ${backend}`,
    ].join("\n"),
  };
}

export async function handleApiCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  const { chatId, args } = options;
  const bound = resolveBoundWorkspace(chatId);
  if (!bound) {
    return {
      success: false,
      message: `本群未绑定任何工作目录\n\n请先使用 /bind <dir> [client] 绑定工作空间`,
    };
  }

  if (args.length === 0) {
    return {
      success: true,
      message: renderApiStatusMessage(getConfiguredApiProvider()),
    };
  }

  const requested = normalizeRequestedApiProvider(args[0] ?? "");
  if (!requested) {
    return {
      success: false,
      message: `无效的 api-provider：${args[0]}\n\n可用值：minimax | deepseek | openai`,
    };
  }

  setConfiguredApiProvider(requested);
  const backend = await getBackendLane(bound.projectDir);
  if (backend === "api") {
    setActiveAgentProvider(requested);
  }

  return {
    success: true,
    message: [
      `已更新 api-provider`,
      "",
      renderApiStatusMessage(requested),
      `backend: ${backend}`,
    ].join("\n"),
  };
}

export async function handleTmuxCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  const { chatId, args } = options;
  const bound = resolveBoundWorkspace(chatId);
  if (!bound) {
    return {
      success: false,
      message: `本群未绑定任何工作目录\n\n请先使用 /bind <dir> [client] 绑定工作空间`,
    };
  }

  if (args.length === 0) {
    return {
      success: true,
      message: renderTmuxStatusMessage(getTmuxClientLabel(await getTmuxClient(bound.projectDir))),
    };
  }

  const requested = normalizeRequestedTmuxClient(args[0] ?? "");
  if (!requested) {
    return {
      success: false,
      message: `无效的 tmux-client：${args[0]}\n\n可用值：codex | claude-code`,
    };
  }

  const backend = await getBackendLane(bound.projectDir);
  if (backend === "tmux") {
    const blocked = await ensureTmuxAllowed(bound.projectDir);
    if (blocked) return blocked;
  }

  await setTmuxClient(bound.projectDir, requested);

  return {
    success: true,
    message: [
      `已更新 tmux-client`,
      "",
      renderTmuxStatusMessage(requested),
      `backend: ${backend}`,
    ].join("\n"),
  };
}

export async function handleTextModelCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  return handleModelFieldCommand("text", options);
}

export async function handleVisionModelCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  return handleModelFieldCommand("vision", options);
}

export async function handleTtsModelCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  return handleModelFieldCommand("tts", options);
}

export async function handleEmbeddingModelCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  return handleModelFieldCommand("embedding", options);
}

export async function handleModelCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  const { args } = options;

  if (args.length === 0 || (args[0] ?? "").trim().toLowerCase() === "status") {
    const bound = resolveBoundWorkspace(options.chatId);
    if (!bound) {
      return {
        success: false,
        message: `本群未绑定任何工作目录\n\n请先使用 /bind <dir> [client] 绑定工作空间`,
      };
    }
    return {
      success: true,
      message: await buildModelStatus(bound.projectDir),
    };
  }

  const requested = (args[0] ?? "").trim().toLowerCase();

  if (requested === "agent-backend" || requested === "agent" || requested === "local-openai") {
    return handleBackendCommand({ ...options, args: ["local"] });
  }

  const localBackend = normalizeRequestedLocalBackend(requested);
  if (localBackend) {
    await handleLocalCommand({ ...options, args: [localBackend] });
    const backendResult = await handleBackendCommand({ ...options, args: ["local"] });
    return {
      success: backendResult.success,
      message: `${backendResult.message}\n\n兼容提示：旧命令 /model ${requested} 已映射为 /local ${localBackend} + /backend local`,
    };
  }

  const apiProvider = normalizeRequestedApiProvider(requested);
  if (apiProvider) {
    await handleApiCommand({ ...options, args: [apiProvider] });
    const backendResult = await handleBackendCommand({ ...options, args: ["api"] });
    return {
      success: backendResult.success,
      message: `${backendResult.message}\n\n兼容提示：旧命令 /model ${requested} 已映射为 /api ${apiProvider} + /backend api`,
    };
  }

  const tmuxClient = normalizeRequestedTmuxClient(requested);
  if (tmuxClient) {
    const presetResult = await handleTmuxCommand({ ...options, args: [tmuxClient] });
    if (!presetResult.success) {
      return presetResult;
    }
    const backendResult = await handleBackendCommand({ ...options, args: ["tmux"] });
    if (!backendResult.success) {
      return backendResult;
    }
    return {
      success: true,
      message: `${backendResult.message}\n\n兼容提示：旧命令 /model ${requested} 已映射为 /tmux ${tmuxClient} + /backend tmux`,
    };
  }

  return {
    success: false,
    message: `无效的 /model 参数：${args[0]}\n\n` +
      `新协议：/model status | /backend <local|api|tmux> | /local <omlx|lmstudio> | /api <minimax|deepseek|openai> | /tmux <codex|claude-code>`,
  };
}

export async function handlePolicyCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  const { chatId, args } = options;
  const bound = resolveBoundWorkspace(chatId);
  if (!bound) {
    return {
      success: false,
      message: `本群未绑定工作目录\n\n请先使用 /bind <dir> 绑定工作空间`,
    };
  }

  function describePolicyMode(mode: "local-only" | "egress-allowed"): { short: "limit" | "full"; label: string; raw: string } {
    if (mode === "egress-allowed") {
      return { short: "full", label: "外网已开", raw: mode };
    }
    return { short: "limit", label: "仅本地", raw: mode };
  }

  function normalizePolicyMode(input: string): "local-only" | "egress-allowed" | null {
    const value = input.trim().toLowerCase();
    if (["on", "full", "egress", "egress-allowed", "allow", "open"].includes(value)) {
      return "egress-allowed";
    }
    if (["off", "limit", "local", "local-only", "deny", "closed"].includes(value)) {
      return "local-only";
    }
    return null;
  }

  if (args.length === 0) {
    const currentMode = await getPolicyMode(bound.projectDir);
    const current = describePolicyMode(currentMode);

    return {
      success: true,
      message: `策略模式\n\n` +
        `当前：${current.short}（${current.label}；raw=${current.raw}）\n` +
        `工作目录：${bound.label || bound.projectDir}\n\n` +
        `可用模式:\n` +
        `  full   外网已开（可使用 codex/claude-code；= egress-allowed）\n` +
        `  limit  仅本地（禁止外网访问；= local-only）\n\n` +
        `用法:\n` +
        `  /policy full   开外网\n` +
        `  /policy limit  仅本地`,
    };
  }

  const requestedMode = normalizePolicyMode(args[0] ?? "");
  if (!requestedMode) {
    return {
      success: false,
      message: `无效的策略模式：${args[0]}\n\n` +
        `可用模式:\n` +
        `  on / egress-allowed   允许外网访问\n` +
        `  off / local-only      仅本地模式`,
    };
  }

  try {
    const oldMode = await getPolicyMode(bound.projectDir);
    const oldDesc = describePolicyMode(oldMode);
    const newDesc = describePolicyMode(requestedMode);
    await setPolicyMode(bound.projectDir, requestedMode);

    if (oldMode === requestedMode) {
      return {
        success: true,
        message: `策略模式未变更\n\n当前：${newDesc.short}（${newDesc.label}；raw=${newDesc.raw}）`,
      };
    }

    return {
      success: true,
      message: `已切换策略模式\n\n` +
        `旧模式：${oldDesc.short}（${oldDesc.label}；raw=${oldDesc.raw}）\n` +
        `新模式：${newDesc.short}（${newDesc.label}；raw=${newDesc.raw}）\n\n` +
        `${requestedMode === "egress-allowed"
          ? "现在可以使用 tmux 分支了"
          : "已禁止使用外网执行分支，只能使用本地模型"}`,
    };
  } catch (error) {
    return {
      success: false,
      message: `切换失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
