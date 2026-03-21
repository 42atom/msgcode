import path from "node:path";
import { existsSync } from "node:fs";
import type { Diagnostic } from "../memory/types.js";
import {
  getAgentProvider,
  getBackendLane,
  getBranchModel,
  getRuntimeKind,
  getTmuxClient,
  type AgentProvider,
  type BackendLane,
  type ModelLane,
} from "../config/workspace.js";
import { resolveAsrPaths, resolveQwenTtsPaths } from "../media/model-paths.js";
import { resolveLocalBackendRuntime } from "../local-backend/registry.js";

export interface WorkspaceCapabilityEntry {
  id: "brain" | "vision" | "tts" | "asr" | "image" | "video" | "music" | "search";
  title: string;
  configured: boolean;
  source: "api" | "local" | "";
  model: string;
  note: string;
}

export interface WorkspaceCapabilitySurfaceData {
  workspacePath: string;
  runtime: {
    kind: "agent" | "tmux";
    lane: BackendLane;
    agentProvider: AgentProvider | "none";
    tmuxClient: "codex" | "claude-code" | "none";
  };
  capabilities: WorkspaceCapabilityEntry[];
}

export async function readWorkspaceCapabilitySurface(
  workspacePath: string,
): Promise<{ data: WorkspaceCapabilitySurfaceData; warnings: Diagnostic[] }> {
  const warnings: Diagnostic[] = [];
  const runtimeKind = await getRuntimeKind(workspacePath);
  const lane = await getBackendLane(workspacePath);
  const agentProvider = await getAgentProvider(workspacePath);
  const tmuxClient = await getTmuxClient(workspacePath);

  if (runtimeKind === "tmux") {
    warnings.push({
      code: "WORKSPACE_CAPABILITY_TMUX_MODE",
      message: "当前工作区走 tmux 执行臂，能力配置读面只返回空态",
      hint: "切回 agent 模式后，再配置大脑/视觉/语音等能力位",
      details: { workspacePath, tmuxClient },
    });
  }

  return {
    data: {
      workspacePath,
      runtime: {
        kind: runtimeKind,
        lane,
        agentProvider,
        tmuxClient,
      },
      capabilities: [
        await readBrainCapability(workspacePath, runtimeKind, lane, agentProvider, tmuxClient),
        await readVisionCapability(workspacePath, runtimeKind, lane),
        await readTtsCapability(workspacePath, runtimeKind, lane),
        readAsrCapability(runtimeKind),
        emptyCapability("image", "画图模型"),
        emptyCapability("video", "视频模型"),
        emptyCapability("music", "音乐模型"),
        emptyCapability("search", "联网搜索"),
      ],
    },
    warnings,
  };
}

async function readBrainCapability(
  workspacePath: string,
  runtimeKind: "agent" | "tmux",
  lane: BackendLane,
  agentProvider: AgentProvider | "none",
  tmuxClient: "codex" | "claude-code" | "none",
): Promise<WorkspaceCapabilityEntry> {
  if (runtimeKind === "tmux" || lane === "tmux") {
    return {
      id: "brain",
      title: "大脑模型",
      configured: false,
      source: "",
      model: "",
      note: tmuxClient === "none" ? "当前未配置 tmux client" : `当前走 tmux:${tmuxClient}`,
    };
  }

  const activeLane = lane as ModelLane;
  const explicitModel = await getBranchModel(workspacePath, activeLane, "text");
  const localBackend = activeLane === "local" ? resolveLocalBackendRuntime() : null;
  const providerNote = activeLane === "local"
    ? `local:${localBackend?.id ?? "unknown"}`
    : `api:${agentProvider}`;

  return {
    id: "brain",
    title: "大脑模型",
    configured: true,
    source: activeLane,
    model: explicitModel || "auto",
    note: providerNote,
  };
}

async function readVisionCapability(
  workspacePath: string,
  runtimeKind: "agent" | "tmux",
  lane: BackendLane,
): Promise<WorkspaceCapabilityEntry> {
  if (runtimeKind === "tmux" || lane === "tmux") {
    return emptyCapability("vision", "视觉模型");
  }

  const activeLane = lane as ModelLane;
  const explicitModel = await getBranchModel(workspacePath, activeLane, "vision");
  const localBackend = activeLane === "local" ? resolveLocalBackendRuntime() : null;
  const model = explicitModel || (activeLane === "local" ? localBackend?.visionModel || localBackend?.model || "" : "");

  return {
    id: "vision",
    title: "视觉模型",
    configured: Boolean(model),
    source: model ? activeLane : "",
    model,
    note: model
      ? explicitModel
        ? "workspace 显式覆盖"
        : activeLane === "local"
          ? "跟随本地后端默认视觉模型"
          : "跟随当前 API 视觉配置"
      : "当前无统一视觉模型配置",
  };
}

async function readTtsCapability(
  workspacePath: string,
  runtimeKind: "agent" | "tmux",
  lane: BackendLane,
): Promise<WorkspaceCapabilityEntry> {
  if (runtimeKind === "tmux" || lane === "tmux") {
    return emptyCapability("tts", "语音输出");
  }

  const activeLane = lane as ModelLane;
  const explicitModel = await getBranchModel(workspacePath, activeLane, "tts");
  const qwenPaths = resolveQwenTtsPaths();
  const qwenConfigured = existsSync(qwenPaths.root) && existsSync(qwenPaths.python) && existsSync(qwenPaths.customModel);
  const model = explicitModel || (qwenConfigured ? "qwen" : "");
  const source = model ? (explicitModel ? activeLane : "local") : "";

  return {
    id: "tts",
    title: "语音输出",
    configured: Boolean(model),
    source,
    model,
    note: model
      ? explicitModel
        ? "workspace 显式覆盖"
        : `跟随 ${qwenPaths.source === "env" ? "env" : "默认"} Qwen TTS`
      : "当前无统一语音输出配置",
  };
}

function readAsrCapability(runtimeKind: "agent" | "tmux"): WorkspaceCapabilityEntry {
  if (runtimeKind === "tmux") {
    return emptyCapability("asr", "听觉识别");
  }

  const asrPaths = resolveAsrPaths();
  const configured = existsSync(asrPaths.modelDir);
  return {
    id: "asr",
    title: "听觉识别",
    configured,
    source: configured ? "local" : "",
    model: configured ? path.basename(asrPaths.modelDir) : "",
    note: configured
      ? `跟随 ${asrPaths.source === "env" ? "env" : "默认"} Whisper 模型目录`
      : "当前无统一 ASR 模型目录",
  };
}

function emptyCapability(
  id: WorkspaceCapabilityEntry["id"],
  title: string,
): WorkspaceCapabilityEntry {
  return {
    id,
    title,
    configured: false,
    source: "",
    model: "",
    note: "当前无统一真相源",
  };
}
