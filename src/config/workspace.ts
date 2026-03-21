/**
 * msgcode: Workspace 配置管理
 *
 * 负责读取和写入 <WORKSPACE>/.msgcode/config.json
 *
 * 配置优先级（从高到低）：
 * 1. CLI 显式参数
 * 2. ENV 变量 (MEMORY_INJECT_ENABLED/TOPK/MAX_CHARS)
 * 3. workspace config.json
 * 4. 默认值
 *
 * P5.6.14-R1: 配置域拆分
 * - 新增：runtime.kind、agent.provider、tmux.client
 * - 保留：runner.default（只读兼容映射）
 *
 * P5.7-R3e: 双模型路由
 * - 新增：model.executor、model.responder
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ToolName, ToolingMode } from "../tools/types.js";
import { GHOST_TOOL_NAMES } from "../runners/ghost-mcp-contract.js";

type LegacyAgentProviderAlias = "lmstudio" | "llama" | "claude";
type StoredAgentProvider = AgentProvider | LegacyAgentProviderAlias;

/**
 * Workspace 配置（存储在 .msgcode/config.json）
 * P5.6.14-R1: 配置域拆分 - 新增 runtime.kind/agent.provider/tmux.client
 * P5.7-R3e: 双模型路由 - 新增 model.executor/model.responder
 * P5.7-R24: backend lanes - 新增 model.local.* / model.api.*
 */
export interface WorkspaceConfig {
  // ==================== 设置页：我的资料 ====================
  /** 我的称呼（设置页“我的资料”） */
  "profile.name"?: string;

  // ==================== 记忆注入配置 ====================
  /** 记忆注入开关（默认 false） */
  "memory.inject.enabled"?: boolean;
  /** 记忆注入返回条数（默认 5） */
  "memory.inject.topK"?: number;
  /** 记忆注入最大字符数（默认 2000） */
  "memory.inject.maxChars"?: number;

  // ==================== P5.7-R3e: 双模型路由配置 ====================
  /**
   * 执行模型：用于工具调用（temperature=0）
   * 默认：空字符串（由调用层自动解析当前已加载模型）
   */
  "model.executor"?: string;

  /**
   * 响应模型：用于非工具回复（temperature=0.2）
   * 默认：空字符串（由调用层自动解析当前已加载模型）
   */
  "model.responder"?: string;

  /**
   * local 分支文本模型覆盖
   * - 空字符串：显式 auto（不再回退 legacy executor/responder）
   */
  "model.local.text"?: string;
  /** local 分支视觉模型覆盖 */
  "model.local.vision"?: string;
  /** local 分支 TTS 模型覆盖 */
  "model.local.tts"?: string;
  /** local 分支 embedding 模型覆盖 */
  "model.local.embedding"?: string;

  /**
   * api 分支文本模型覆盖
   * - 空字符串：显式 auto（不再回退 legacy executor/responder）
   */
  "model.api.text"?: string;
  /** api 分支视觉模型覆盖 */
  "model.api.vision"?: string;
  /** api 分支 TTS 模型覆盖 */
  "model.api.tts"?: string;
  /** api 分支 embedding 模型覆盖 */
  "model.api.embedding"?: string;

  // ==================== P5.6.14-R1: 运行形态配置 ====================
  /**
   * 运行形态：agent（默认）| tmux
   * - agent: 智能体执行形态（有上下文编排：SOUL/记忆/工具注入）
   * - tmux: 透传执行形态（无上下文编排，忠实转发）
   */
  "runtime.kind"?: "agent" | "tmux";

  /**
   * 当前请求所属 transport（运行时写入）
   * - feishu: 飞书 Bot 链路
   */
  "runtime.current_transport"?: "feishu";

  /**
   * 当前请求所属 chatId（运行时写入）
   * - 飞书场景：oc_xxx
   */
  "runtime.current_chat_id"?: string;

  /**
   * 当前请求所属完整 chatGuid（运行时写入）
   * - 飞书场景：feishu:oc_xxx
   */
  "runtime.current_chat_guid"?: string;

  /**
   * Agent Provider（仅 runtime.kind=agent 时有效）
   * - agent-backend: 本地后端入口（默认）
   * - minimax: MiniMax 模型
   * - openai: OpenAI API
   * - deepseek: DeepSeek API
   * - 历史配置中可能仍出现 lmstudio/llama/claude，读取时会归一化
   */
  "agent.provider"?: StoredAgentProvider;

  /**
   * Tmux Client（仅 runtime.kind=tmux 时有效）
   * - codex: Codex CLI
   * - claude-code: Claude Code CLI
   */
  "tmux.client"?: TmuxClient;

  // ==================== M5: 兼容配置（只读映射） ====================
  /**
   * 策略模式：local-only（仅本地）或 egress-allowed（允许外联）
   * - local-only: 禁止使用需要外网的 runner（如 codex）
   * - egress-allowed: 允许使用所有 runner
   */
  "policy.mode"?: "local-only" | "egress-allowed";

  /**
   * 默认执行臂（只读兼容，v2.3.x 保留映射，v2.4.0 移除）
   * P5.7-R9-T6: 新增 agent-backend 中性语义
   * 映射规则：
   * - codex|claude-code -> runtime.kind=tmux + tmux.client=<runner>
   * - agent-backend|lmstudio -> runtime.kind=agent + agent.provider=agent-backend
   * - openai|minimax|deepseek -> runtime.kind=agent + agent.provider=<runner>
   * - llama|claude -> runtime.kind=agent + agent.provider=agent-backend（兼容降级）
   */
  "runner.default"?: "agent-backend" | "lmstudio" | "minimax" | "deepseek" | "llama" | "claude" | "openai" | "codex" | "claude-code";

  // ==================== Tool Bus 配置 ====================
  /**
   * 工具执行模式：explicit（默认稳态）、autonomous（可选）、tool-calls（预留）
   * - explicit: 只允许显式命令触发工具（/tts、/asr 等）
   * - autonomous: 模型可自主编排调用工具（含 bash/browser）
   * - tool-calls: 预留，标准 tool_calls 自动工具调用
   */
  "tooling.mode"?: ToolingMode;

  /**
   * 允许的工具列表
   * - 默认：当前已实现正式工具默认全开
   */
  "tooling.allow"?: ToolName[];

  /**
   * 需要确认的工具列表
   * - 默认：[]
   */
  "tooling.require_confirm"?: ToolName[];

  // ==================== P5.7-R3i: 文件工具权限策略 ====================
  /**
   * 文件工具作用域策略：workspace | unrestricted
   * - workspace: 仅允许访问工作区内的文件（安全模式）
   * - unrestricted: 允许访问全盘文件（当前默认，测试期兼容）
   */
  "tooling.fs_scope"?: FsScope;

  // ==================== 飞书配置 ====================
  /**
   * 飞书 App ID
   */
  "feishu.appId"?: string;

  /**
   * 飞书 App Secret
   */
  "feishu.appSecret"?: string;

  /**
   * 飞书 Encrypt Key（可选）
   */
  "feishu.encryptKey"?: string;
}

/**
 * P5.7-R3i: 文件工具作用域策略
 * - workspace: 仅允许访问工作区内的文件
 * - unrestricted: 允许访问全盘文件（当前默认，测试期兼容）
 */
export type FsScope = "workspace" | "unrestricted";

/**
 * P5.6.14-R1b: Agent Provider 类型（agent 模式下有效）
 * 只表达当前真实 provider；历史别名读取时在内部归一化
 */
export type AgentProvider = "agent-backend" | "minimax" | "deepseek" | "openai";

/**
 * P5.7-R24: 执行基座 lane
 * - local: agent + 本地后端入口
 * - api: agent + 远端 API provider
 * - tmux: tmux 执行臂
 */
export type BackendLane = "local" | "api" | "tmux";

/**
 * P5.7-R24: 可存储模型覆盖的 lane（tmux 不消费模型字段）
 */
export type ModelLane = "local" | "api";

/**
 * P5.7-R24: 模型槽位
 */
export type ModelSlot = "text" | "vision" | "tts" | "embedding";

/**
 * P5.6.14-R1b: Tmux Client 类型（tmux 模式下有效）
 */
export type TmuxClient = "codex" | "claude-code";

/**
 * Workspace 配置的默认值
 * P5.6.8-R4g: 导出供测试使用
 * P5.6.14-R1: 新增 runtime.kind 默认值为 agent
 * P5.6.14-R1b: 使用 AgentProvider/TmuxClient 类型
 * P5.7-R3e: 新增 model.executor/model.responder 默认值
 */
export const DEFAULT_WORKSPACE_CONFIG: Required<WorkspaceConfig> = {
  "profile.name": "",
  "memory.inject.enabled": true, // 测试期默认开启记忆注入
  "memory.inject.topK": 5,
  "memory.inject.maxChars": 2000,
  "model.executor": "", // P5.7-R3e: 空=继承 agent.provider
  "model.responder": "", // P5.7-R3e: 空=继承 agent.provider
  "model.local.text": "",
  "model.local.vision": "",
  "model.local.tts": "",
  "model.local.embedding": "",
  "model.api.text": "",
  "model.api.vision": "",
  "model.api.tts": "",
  "model.api.embedding": "",
  "policy.mode": "egress-allowed", // 默认允许外联（远程场景避免被门禁卡住；高敏 workspace 可手动切回 local-only）
  "runtime.kind": "agent", // P5.6.14-R1: 默认 agent 形态
  "runtime.current_transport": "feishu",
  "runtime.current_chat_id": "",
  "runtime.current_chat_guid": "",
  "agent.provider": "agent-backend", // P5.7-R9-T6: 默认 agent-backend（中性语义）
  "tmux.client": "codex", // P5.6.14-R1: 默认 codex client
  "runner.default": "agent-backend", // P5.7-R9-T6: 兼容字段，默认 agent-backend
  "tooling.mode": "autonomous", // P5.5: 测试期统一 autonomous（LLM 自主决策 tool_calls）
  "tooling.allow": ["tts", "asr", "vision", "bash", "browser", "read_file", "write_file", "edit_file", "help_docs", "feishu_list_members", "feishu_list_recent_messages", "feishu_reply_message", "feishu_react_message", "feishu_send_file", ...GHOST_TOOL_NAMES], // 默认对当前已实现正式工具全开；legacy desktop 仍不恢复，未实现 mem 仍不默认暴露
  "tooling.require_confirm": [], // 默认不要求确认
  "tooling.fs_scope": "unrestricted", // 当前默认 unrestricted，避免扩大变更面
  "feishu.appId": "", // 飞书 App ID（默认空，需要用户配置）
  "feishu.appSecret": "", // 飞书 App Secret（默认空，需要用户配置）
  "feishu.encryptKey": "", // 飞书 Encrypt Key（默认空，可选）
};

/**
 * 获取 workspace 配置文件路径
 */
function getConfigPath(projectDir: string): string {
  return join(projectDir, ".msgcode", "config.json");
}

/**
 * 读取 workspace 配置
 *
 * @param projectDir 工作区路径
 * @returns 配置对象（如果文件不存在返回默认值）
 */
export async function loadWorkspaceConfig(
  projectDir: string
): Promise<WorkspaceConfig> {
  const configPath = getConfigPath(projectDir);

  // 如果配置文件不存在，返回默认值
  if (!existsSync(configPath)) {
    return {};
  }

  try {
    const content = await readFile(configPath, "utf-8");
    return JSON.parse(content) as WorkspaceConfig;
  } catch (error) {
    // 解析失败，返回默认值
    return {};
  }
}

/**
 * 写入 workspace 配置
 *
 * @param projectDir 工作区路径
 * @param config 要写入的配置（部分更新）
 */
export async function saveWorkspaceConfig(
  projectDir: string,
  config: Partial<WorkspaceConfig>
): Promise<void> {
  const configPath = getConfigPath(projectDir);
  const configDir = join(projectDir, ".msgcode");

  // 确保 .msgcode 目录存在
  if (!existsSync(configDir)) {
    await mkdir(configDir, { recursive: true });
  }

  // 读取现有配置（如果存在）
  const existing = await loadWorkspaceConfig(projectDir);

  // 合并配置
  const merged: WorkspaceConfig = {
    ...existing,
    ...config,
  };

  // 写入配置文件
  await writeFile(configPath, JSON.stringify(merged, null, 2), "utf-8");
}

export async function saveCurrentSessionContext(
  projectDir: string,
  session: {
    transport: "feishu";
    chatId: string;
    chatGuid: string;
  }
): Promise<void> {
  await saveWorkspaceConfig(projectDir, {
    "runtime.current_transport": session.transport,
    "runtime.current_chat_id": session.chatId,
    "runtime.current_chat_guid": session.chatGuid,
  });
}

/**
 * 获取记忆注入配置（考虑优先级）
 *
 * @param projectDir 工作区路径
 * @returns 注入配置 { enabled: boolean, topK: number, maxChars: number }
 */
export async function getMemoryInjectConfig(
  projectDir: string
): Promise<{ enabled: boolean; topK: number; maxChars: number }> {
  // 1. 检查 ENV 变量（优先级高于 workspace config）
  const envEnabled = process.env.MEMORY_INJECT_ENABLED;
  if (envEnabled !== undefined) {
    return {
      enabled: envEnabled === "1" || envEnabled.toLowerCase() === "true",
      topK: Number(process.env.MEMORY_INJECT_TOPK) || 5,
      maxChars: Number(process.env.MEMORY_INJECT_MAX_CHARS) || 2000,
    };
  }

  // 2. 读取 workspace config
  const workspaceConfig = await loadWorkspaceConfig(projectDir);

  return {
    enabled: workspaceConfig["memory.inject.enabled"] ?? DEFAULT_WORKSPACE_CONFIG["memory.inject.enabled"],
    topK: workspaceConfig["memory.inject.topK"] ?? DEFAULT_WORKSPACE_CONFIG["memory.inject.topK"],
    maxChars: workspaceConfig["memory.inject.maxChars"] ?? DEFAULT_WORKSPACE_CONFIG["memory.inject.maxChars"],
  };
}

// ============================================
// P5.6.14-R1: 运行形态配置（Kind/Provider/Client）
// ============================================

/**
 * 从 runner.default 映射到 runtime.kind/provider/client
 * P5.6.14-R1: 兼容映射层（只读）
 * P5.6.14-R1b: 使用 AgentProvider/TmuxClient 类型
 * P5.7-R9-T6: 新增 agent-backend 支持，默认回退到 agent-backend
 */
function mapRunnerToKindProviderClient(
  runner: "agent-backend" | "lmstudio" | "minimax" | "deepseek" | "llama" | "claude" | "openai" | "codex" | "claude-code" | undefined
): { kind: "agent" | "tmux"; provider?: AgentProvider; client?: TmuxClient } {
  if (!runner) {
    return { kind: "agent", provider: "agent-backend" };
  }

  // codex|claude-code -> tmux + client
  if (runner === "codex" || runner === "claude-code") {
    return { kind: "tmux", client: runner };
  }

  // agent-backend|openai|minimax|deepseek -> agent + provider
  if (
    runner === "agent-backend" ||
    runner === "openai" ||
    runner === "minimax" ||
    runner === "deepseek"
  ) {
    return { kind: "agent", provider: runner };
  }

  // lmstudio|llama|claude -> agent + provider=agent-backend（兼容降级）
  return { kind: "agent", provider: "agent-backend" };
}

function normalizeStoredAgentProvider(
  raw: StoredAgentProvider | "" | undefined
): AgentProvider | undefined {
  if (!raw) return undefined;
  if (raw === "agent-backend" || raw === "minimax" || raw === "deepseek" || raw === "openai") {
    return raw;
  }
  return "agent-backend";
}

/**
 * 获取运行形态
 * P5.6.14-R1: 优先读新字段，无新字段时从 runner.default 映射
 *
 * @param projectDir 工作区路径
 * @returns 运行形态（agent | tmux）
 */
export async function getRuntimeKind(
  projectDir: string
): Promise<"agent" | "tmux"> {
  const workspaceConfig = await loadWorkspaceConfig(projectDir);

  // 优先读新字段
  if (workspaceConfig["runtime.kind"]) {
    return workspaceConfig["runtime.kind"];
  }

  // Fallback: 从 runner.default 映射
  const runner = workspaceConfig["runner.default"];
  return mapRunnerToKindProviderClient(runner).kind;
}

/**
 * 获取 Agent Provider
 * P5.6.14-R1: 优先读新字段，无新字段时从 runner.default 映射
 * P5.6.14-R1b: 使用 AgentProvider 类型
 *
 * @param projectDir 工作区路径
 * @returns Agent Provider（agent-backend | minimax | deepseek | openai | none）
 */
export async function getAgentProvider(
  projectDir: string
): Promise<AgentProvider | "none"> {
  const workspaceConfig = await loadWorkspaceConfig(projectDir);

  // 优先读新字段
  if (workspaceConfig["agent.provider"]) {
    return normalizeStoredAgentProvider(workspaceConfig["agent.provider"]) || "none";
  }

  // Fallback: 从 runner.default 映射
  const runner = workspaceConfig["runner.default"];
  const mapped = mapRunnerToKindProviderClient(runner);
  return (mapped.provider as AgentProvider) || "none";
}

/**
 * 获取 Tmux Client
 * P5.6.14-R1: 优先读新字段，无新字段时从 runner.default 映射
 * P5.6.14-R1b: 使用 TmuxClient 类型
 *
 * @param projectDir 工作区路径
 * @returns Tmux Client（codex | claude-code | none）
 */
export async function getTmuxClient(
  projectDir: string
): Promise<TmuxClient | "none"> {
  const workspaceConfig = await loadWorkspaceConfig(projectDir);

  // 优先读新字段
  if (workspaceConfig["tmux.client"]) {
    return workspaceConfig["tmux.client"];
  }

  // Fallback: 从 runner.default 映射
  const runner = workspaceConfig["runner.default"];
  const mapped = mapRunnerToKindProviderClient(runner);
  return (mapped.client as TmuxClient) || "none";
}

/**
 * 设置运行形态（写配置只写新字段）
 *
 * @param projectDir 工作区路径
 * @param kind 运行形态
 */
export async function setRuntimeKind(
  projectDir: string,
  kind: "agent" | "tmux"
): Promise<void> {
  await saveWorkspaceConfig(projectDir, { "runtime.kind": kind });
}

/**
 * 设置 Agent Provider（写配置只写新字段）
 * P5.6.14-R1b: 使用 AgentProvider 类型
 *
 * @param projectDir 工作区路径
 * @param provider Agent Provider
 */
export async function setAgentProvider(
  projectDir: string,
  provider: AgentProvider
): Promise<void> {
  await saveWorkspaceConfig(projectDir, { "agent.provider": provider });
}

/**
 * 设置 Tmux Client（写配置只写新字段）
 * P5.6.14-R1b: 使用 TmuxClient 类型
 *
 * @param projectDir 工作区路径
 * @param client Tmux Client
 */
export async function setTmuxClient(
  projectDir: string,
  client: TmuxClient
): Promise<void> {
  await saveWorkspaceConfig(projectDir, { "tmux.client": client });
}

// ============================================
// M5: Policy & Runner 配置（兼容层）
// ============================================

/**
 * 获取策略模式
 *
 * @param projectDir 工作区路径
 * @returns 策略模式（local-only 或 egress-allowed）
 */
export async function getPolicyMode(
  projectDir: string
): Promise<"local-only" | "egress-allowed"> {
  const workspaceConfig = await loadWorkspaceConfig(projectDir);
  return workspaceConfig["policy.mode"] ?? DEFAULT_WORKSPACE_CONFIG["policy.mode"];
}

/**
 * 设置策略模式
 *
 * @param projectDir 工作区路径
 * @param mode 策略模式
 */
export async function setPolicyMode(
  projectDir: string,
  mode: "local-only" | "egress-allowed"
): Promise<void> {
  await saveWorkspaceConfig(projectDir, { "policy.mode": mode });
}

/**
 * 获取默认执行臂（兼容层，只读）
 * P5.6.14-R1: 从新字段反向映射（只读兼容）
 * P5.7-R9-T6: 新增 agent-backend 中性语义
 *
 * @param projectDir 工作区路径
 * @returns 默认执行臂（agent-backend | lmstudio | llama | claude | openai | codex | claude-code）
 */
export async function getDefaultRunner(
  projectDir: string
): Promise<"agent-backend" | "lmstudio" | "minimax" | "deepseek" | "llama" | "claude" | "openai" | "codex" | "claude-code"> {
  const workspaceConfig = await loadWorkspaceConfig(projectDir);

  // 优先从新字段反向映射
  if (workspaceConfig["runtime.kind"] === "tmux") {
    return (workspaceConfig["tmux.client"] || "codex") as "codex" | "claude-code";
  }

  if (workspaceConfig["runtime.kind"] === "agent") {
    const provider = normalizeStoredAgentProvider(workspaceConfig["agent.provider"]);
    if (provider) {
      return provider as "agent-backend" | "minimax" | "deepseek" | "openai";
    }
  }

  // Fallback: 读旧字段
  return workspaceConfig["runner.default"] ?? DEFAULT_WORKSPACE_CONFIG["runner.default"];
}

/**
 * 设置默认执行臂（兼容层，写新字段）
 * P5.6.14-R1: 根据 runner 映射到新字段
 * P5.7-R9-T6: 新增 agent-backend 中性语义
 *
 * @param projectDir 工作区路径
 * @param runner 默认执行臂
 * @param currentMode 当前策略模式（用于校验）
 * @returns { success: boolean, error?: string } 校验结果
 */
export async function setDefaultRunner(
  projectDir: string,
  runner: "agent-backend" | "lmstudio" | "minimax" | "deepseek" | "llama" | "claude" | "openai" | "codex" | "claude-code",
  currentMode?: "local-only" | "egress-allowed"
): Promise<{ success: boolean; error?: string }> {
  // 如果没有提供 currentMode，读取当前配置
  if (!currentMode) {
    currentMode = await getPolicyMode(projectDir);
  }

  // M5-1: local-only 时禁止 codex/claude-code（需要外网访问）
  if (currentMode === "local-only" && (runner === "codex" || runner === "claude-code")) {
    return {
      success: false,
      error: `当前策略模式为 local-only，不允许使用 ${runner}（需要外网访问）。\n\n` +
        `请先执行以下命令之一：\n` +
        `1. /policy on             （允许外网访问；等同 /policy egress-allowed）\n` +
        `2. /model agent-backend   （使用本地后端）`,
    };
  }

  // P5.6.14-R1: 映射到新字段
  const { kind, provider, client } = mapRunnerToKindProviderClient(runner);
  const configToSave: Partial<WorkspaceConfig> = {
    "runtime.kind": kind,
  };

  if (provider) {
    configToSave["agent.provider"] = provider;
  }
  if (client) {
    configToSave["tmux.client"] = client;
  }

  await saveWorkspaceConfig(projectDir, configToSave);
  return { success: true };
}

// ============================================
// P0: Tool Bus 配置
// ============================================

/**
 * 获取工具策略
 *
 * @param projectDir 工作区路径
 * @returns 工具策略
 */
export async function getToolPolicy(
  projectDir: string
): Promise<{ mode: ToolingMode; allow: ToolName[]; requireConfirm: ToolName[] }> {
  const workspaceConfig = await loadWorkspaceConfig(projectDir);
  return {
    mode: workspaceConfig["tooling.mode"] ?? DEFAULT_WORKSPACE_CONFIG["tooling.mode"],
    allow: (workspaceConfig["tooling.allow"] ?? DEFAULT_WORKSPACE_CONFIG["tooling.allow"]) as ToolName[],
    requireConfirm: (workspaceConfig["tooling.require_confirm"] ?? DEFAULT_WORKSPACE_CONFIG["tooling.require_confirm"]) as ToolName[],
  };
}

/**
 * 设置工具执行模式
 *
 * @param projectDir 工作区路径
 * @param mode 工具执行模式
 */
export async function setToolingMode(
  projectDir: string,
  mode: ToolingMode
): Promise<void> {
  await saveWorkspaceConfig(projectDir, { "tooling.mode": mode });
}

/**
 * 设置允许的工具列表
 *
 * @param projectDir 工作区路径
 * @param allow 允许的工具列表
 */
export async function setToolingAllow(
  projectDir: string,
  allow: ToolName[]
): Promise<void> {
  await saveWorkspaceConfig(projectDir, { "tooling.allow": allow });
}

/**
 * 设置需要确认的工具列表
 *
 * @param projectDir 工作区路径
 * @param requireConfirm 需要确认的工具列表
 */
export async function setToolingRequireConfirm(
  projectDir: string,
  requireConfirm: ToolName[]
): Promise<void> {
  await saveWorkspaceConfig(projectDir, { "tooling.require_confirm": requireConfirm });
}

/**
 * P5.7-R3i: 获取文件工具作用域策略
 *
 * @param projectDir 工作区路径
 * @returns 文件工具作用域（workspace | unrestricted）
 */
export async function getFsScope(
  projectDir: string
): Promise<"workspace" | "unrestricted"> {
  const workspaceConfig = await loadWorkspaceConfig(projectDir);
  return workspaceConfig["tooling.fs_scope"] ?? DEFAULT_WORKSPACE_CONFIG["tooling.fs_scope"];
}

/**
 * P5.7-R3i: 设置文件工具作用域策略
 *
 * @param projectDir 工作区路径
 * @param scope 文件工具作用域
 */
export async function setFsScope(
  projectDir: string,
  scope: "workspace" | "unrestricted"
): Promise<void> {
  await saveWorkspaceConfig(projectDir, { "tooling.fs_scope": scope });
}

// ============================================
// P5.7-R3e: 双模型路由配置
// ============================================

const MODEL_LANES: readonly ModelLane[] = ["local", "api"] as const;
const MODEL_SLOTS: readonly ModelSlot[] = ["text", "vision", "tts", "embedding"] as const;

type StoredModelConfigKey =
  | "model.local.text"
  | "model.local.vision"
  | "model.local.tts"
  | "model.local.embedding"
  | "model.api.text"
  | "model.api.vision"
  | "model.api.tts"
  | "model.api.embedding";

function hasConfigKey<T extends keyof WorkspaceConfig>(
  config: WorkspaceConfig,
  key: T
): boolean {
  return Object.prototype.hasOwnProperty.call(config, key);
}

function normalizeStoredModelValue(raw: string | undefined): string | undefined {
  const normalized = (raw || "").trim();
  return normalized ? normalized : undefined;
}

function normalizeStoredModelValueForSlot(slot: ModelSlot, value: string | undefined): string | undefined {
  if (slot !== "tts") {
    return value;
  }
  if (!value) {
    return undefined;
  }
  return value.trim().toLowerCase() === "qwen" ? "qwen" : undefined;
}

function getStoredModelConfigKey(lane: ModelLane, slot: ModelSlot): StoredModelConfigKey {
  if (!MODEL_LANES.includes(lane)) {
    throw new Error(`未知模型分支: ${lane}`);
  }
  if (!MODEL_SLOTS.includes(slot)) {
    throw new Error(`未知模型槽位: ${slot}`);
  }
  return `model.${lane}.${slot}` as StoredModelConfigKey;
}

function readStoredModelValue(
  config: WorkspaceConfig,
  lane: ModelLane,
  slot: ModelSlot
): { present: boolean; value?: string } {
  const key = getStoredModelConfigKey(lane, slot);
  if (!hasConfigKey(config, key)) {
    return { present: false };
  }
  return {
    present: true,
    value: normalizeStoredModelValue(config[key]),
  };
}

function resolveActiveAgentLaneFromEnv(): ModelLane {
  const raw = (process.env.AGENT_BACKEND || "").trim().toLowerCase();
  if (!raw || raw === "agent-backend" || raw === "local-openai" || raw === "lmstudio" || raw === "omlx") {
    return "local";
  }
  return "api";
}

export async function getBackendLane(projectDir: string): Promise<BackendLane> {
  const kind = await getRuntimeKind(projectDir);
  if (kind === "tmux") {
    return "tmux";
  }
  return resolveActiveAgentLaneFromEnv();
}

/**
 * 读取按分支存储的模型覆盖。
 *
 * 规则：
 * - 显式空字符串 = auto（返回 undefined，但不再回退 legacy 字段）
 * - 未配置时返回 undefined
 * - 仅 text 槽位在缺少新字段时回退 legacy executor/responder
 */
export async function getBranchModel(
  projectDir: string,
  lane: ModelLane,
  slot: ModelSlot
): Promise<string | undefined> {
  const workspaceConfig = await loadWorkspaceConfig(projectDir);
  const stored = readStoredModelValue(workspaceConfig, lane, slot);
  if (stored.present) {
    return normalizeStoredModelValueForSlot(slot, stored.value);
  }

  if (slot !== "text") {
    return undefined;
  }

  const legacyResponder = normalizeStoredModelValue(workspaceConfig["model.responder"]);
  if (legacyResponder) return legacyResponder;
  return normalizeStoredModelValue(workspaceConfig["model.executor"]);
}

export async function setBranchModel(
  projectDir: string,
  lane: ModelLane,
  slot: ModelSlot,
  model: string
): Promise<void> {
  const key = getStoredModelConfigKey(lane, slot);
  const normalized = model.trim();
  await saveWorkspaceConfig(projectDir, {
    [key]: normalized,
  } as Partial<WorkspaceConfig>);
}

export async function getCurrentLaneModel(
  projectDir: string,
  slot: ModelSlot
): Promise<string | undefined> {
  const lane = await getBackendLane(projectDir);
  if (lane === "tmux") {
    return undefined;
  }
  return getBranchModel(projectDir, lane, slot);
}

/**
 * 获取执行模型配置（用于工具调用）
 * P5.7-R3e: 返回 executor 模型，如果未配置则返回 undefined（由调用层自动解析）
 *
 * @param projectDir 工作区路径
 * @returns 执行模型名称（未配置返回 undefined）
 */
export async function getExecutorModel(
  projectDir: string
): Promise<string | undefined> {
  const lane = await getBackendLane(projectDir);
  if (lane === "tmux") {
    return undefined;
  }
  return getBranchModel(projectDir, lane, "text");
}

/**
 * 获取响应模型配置（用于非工具回复）
 * P5.7-R3e: 返回 responder 模型，如果未配置则返回 undefined（由调用层自动解析）
 *
 * @param projectDir 工作区路径
 * @returns 响应模型名称（未配置返回 undefined）
 */
export async function getResponderModel(
  projectDir: string
): Promise<string | undefined> {
  const lane = await getBackendLane(projectDir);
  if (lane === "tmux") {
    return undefined;
  }
  return getBranchModel(projectDir, lane, "text");
}

/**
 * 设置执行模型
 * P5.7-R3e: 设置工具调用使用的模型
 *
 * @param projectDir 工作区路径
 * @param model 模型名称（空字符串表示继承 agent.provider）
 */
export async function setExecutorModel(
  projectDir: string,
  model: string
): Promise<void> {
  const lane = await getBackendLane(projectDir);
  if (lane === "tmux") {
    return;
  }
  const normalized = model.trim();
  await saveWorkspaceConfig(projectDir, {
    [getStoredModelConfigKey(lane, "text")]: normalized,
    "model.executor": normalized,
  } as Partial<WorkspaceConfig>);
}

/**
 * 设置响应模型
 * P5.7-R3e: 设置非工具回复使用的模型
 *
 * @param projectDir 工作区路径
 * @param model 模型名称（空字符串表示继承 agent.provider）
 */
export async function setResponderModel(
  projectDir: string,
  model: string
): Promise<void> {
  const lane = await getBackendLane(projectDir);
  if (lane === "tmux") {
    return;
  }
  const normalized = model.trim();
  await saveWorkspaceConfig(projectDir, {
    [getStoredModelConfigKey(lane, "text")]: normalized,
    "model.responder": normalized,
  } as Partial<WorkspaceConfig>);
}
