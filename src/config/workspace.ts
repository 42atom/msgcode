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

/**
 * Workspace 配置（存储在 .msgcode/config.json）
 * P5.6.14-R1: 配置域拆分 - 新增 runtime.kind/agent.provider/tmux.client
 * P5.7-R3e: 双模型路由 - 新增 model.executor/model.responder
 */
export interface WorkspaceConfig {
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
   * 默认：继承 agent.provider（通常为 lmstudio）
   */
  "model.executor"?: string;

  /**
   * 响应模型：用于非工具回复（temperature=0.2）
   * 默认：继承 agent.provider（通常为 lmstudio）
   */
  "model.responder"?: string;

  // ==================== P5.6.14-R1: 运行形态配置 ====================
  /**
   * 运行形态：agent（默认）| tmux
   * - agent: 智能体执行形态（有上下文编排：SOUL/记忆/工具注入）
   * - tmux: 透传执行形态（无上下文编排，忠实转发）
   */
  "runtime.kind"?: "agent" | "tmux";

  /**
   * Agent Provider（仅 runtime.kind=agent 时有效）
   * - lmstudio: 本地 LM Studio 模型（默认）
   * - minimax: MiniMax 模型
   * - openai: OpenAI API
   * - ...
   */
  "agent.provider"?: AgentProvider;

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
   * 映射规则：
   * - codex|claude-code -> runtime.kind=tmux + tmux.client=<runner>
   * - lmstudio|openai|minimax -> runtime.kind=agent + agent.provider=<runner>
   * - llama|claude -> runtime.kind=agent + agent.provider=lmstudio（兼容降级）
   */
  "runner.default"?: "lmstudio" | "llama" | "claude" | "openai" | "codex" | "claude-code";

  // ==================== PI 配置 ====================
  /**
   * PI 开关（默认 false）
   */
  "pi.enabled"?: boolean;

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
   * - 默认：["tts", "asr", "vision"]
   */
  "tooling.allow"?: ToolName[];

  /**
   * 需要确认的工具列表
   * - 默认：[]
   */
  "tooling.require_confirm"?: ToolName[];
}

/**
 * 工具相关类型
 * P5.6.14-R1b: 新增 AgentProvider/TmuxClient 类型别名
 */
export type ToolingMode = "explicit" | "autonomous" | "tool-calls";
export type ToolName =
  | "tts" | "asr" | "vision" | "mem" | "bash" | "browser" | "desktop"
  | "read_file" | "write_file" | "edit_file";

/**
 * P5.6.14-R1b: Agent Provider 类型（agent 模式下有效）
 */
export type AgentProvider = "lmstudio" | "minimax" | "openai" | "llama" | "claude";

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
  "memory.inject.enabled": true, // 测试期默认开启记忆注入
  "memory.inject.topK": 5,
  "memory.inject.maxChars": 2000,
  "model.executor": "", // P5.7-R3e: 空=继承 agent.provider
  "model.responder": "", // P5.7-R3e: 空=继承 agent.provider
  "policy.mode": "egress-allowed", // 默认允许外联（远程场景避免被门禁卡住；高敏 workspace 可手动切回 local-only）
  "runtime.kind": "agent", // P5.6.14-R1: 默认 agent 形态
  "agent.provider": "lmstudio", // P5.6.14-R1: 默认 lmstudio provider
  "tmux.client": "codex", // P5.6.14-R1: 默认 codex client
  "runner.default": "lmstudio", // 兼容字段，默认 lmstudio
  "pi.enabled": true, // 测试期默认开启 PI
  "tooling.mode": "autonomous", // P5.5: 测试期统一 autonomous（LLM 自主决策 tool_calls）
  "tooling.allow": ["tts", "asr", "vision", "mem", "bash", "browser", "desktop", "read_file", "write_file", "edit_file"], // P5.6.8-R4g: PI 四工具直达
  "tooling.require_confirm": [], // 默认不要求确认
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
 */
function mapRunnerToKindProviderClient(
  runner: "lmstudio" | "llama" | "claude" | "openai" | "codex" | "claude-code" | undefined
): { kind: "agent" | "tmux"; provider?: AgentProvider; client?: TmuxClient } {
  if (!runner) {
    return { kind: "agent", provider: "lmstudio" };
  }

  // codex|claude-code -> tmux + client
  if (runner === "codex" || runner === "claude-code") {
    return { kind: "tmux", client: runner };
  }

  // lmstudio|openai|minimax -> agent + provider
  if (runner === "lmstudio" || runner === "openai") {
    return { kind: "agent", provider: runner };
  }

  // llama|claude -> agent + provider=lmstudio（兼容降级）
  return { kind: "agent", provider: "lmstudio" };
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
 * @returns Agent Provider（lmstudio | minimax | openai | none）
 */
export async function getAgentProvider(
  projectDir: string
): Promise<AgentProvider | "none"> {
  const workspaceConfig = await loadWorkspaceConfig(projectDir);

  // 优先读新字段
  if (workspaceConfig["agent.provider"]) {
    return workspaceConfig["agent.provider"];
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
 *
 * @param projectDir 工作区路径
 * @returns 默认执行臂（lmstudio | llama | claude | openai | codex | claude-code）
 */
export async function getDefaultRunner(
  projectDir: string
): Promise<"lmstudio" | "llama" | "claude" | "openai" | "codex" | "claude-code"> {
  const workspaceConfig = await loadWorkspaceConfig(projectDir);

  // 优先从新字段反向映射
  if (workspaceConfig["runtime.kind"] === "tmux") {
    return (workspaceConfig["tmux.client"] || "codex") as "codex" | "claude-code";
  }

  if (workspaceConfig["runtime.kind"] === "agent") {
    const provider = workspaceConfig["agent.provider"];
    if (provider) {
      // minimax/llama/claude 映射回 lmstudio（兼容返回）
      if (provider === "minimax" || provider === "llama" || provider === "claude") {
        return "lmstudio";
      }
      return provider as "lmstudio" | "openai";
    }
  }

  // Fallback: 读旧字段
  return workspaceConfig["runner.default"] ?? DEFAULT_WORKSPACE_CONFIG["runner.default"];
}

/**
 * 设置默认执行臂（兼容层，写新字段）
 * P5.6.14-R1: 根据 runner 映射到新字段
 *
 * @param projectDir 工作区路径
 * @param runner 默认执行臂
 * @param currentMode 当前策略模式（用于校验）
 * @returns { success: boolean, error?: string } 校验结果
 */
export async function setDefaultRunner(
  projectDir: string,
  runner: "lmstudio" | "llama" | "claude" | "openai" | "codex" | "claude-code",
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
        `2. /model lmstudio        （使用本地模型）`,
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

// ============================================
// P5.7-R3e: 双模型路由配置
// ============================================

/**
 * 获取执行模型配置（用于工具调用）
 * P5.7-R3e: 返回 executor 模型，如果未配置则继承 agent.provider
 *
 * @param projectDir 工作区路径
 * @returns 执行模型名称
 */
export async function getExecutorModel(
  projectDir: string
): Promise<string> {
  const workspaceConfig = await loadWorkspaceConfig(projectDir);

  // 优先使用显式配置
  const executor = workspaceConfig["model.executor"];
  if (executor && executor.trim()) {
    return executor.trim();
  }

  // Fallback: 继承 agent.provider
  const provider = await getAgentProvider(projectDir);
  return provider === "none" ? "lmstudio" : provider;
}

/**
 * 获取响应模型配置（用于非工具回复）
 * P5.7-R3e: 返回 responder 模型，如果未配置则继承 agent.provider
 *
 * @param projectDir 工作区路径
 * @returns 响应模型名称
 */
export async function getResponderModel(
  projectDir: string
): Promise<string> {
  const workspaceConfig = await loadWorkspaceConfig(projectDir);

  // 优先使用显式配置
  const responder = workspaceConfig["model.responder"];
  if (responder && responder.trim()) {
    return responder.trim();
  }

  // Fallback: 继承 agent.provider
  const provider = await getAgentProvider(projectDir);
  return provider === "none" ? "lmstudio" : provider;
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
  await saveWorkspaceConfig(projectDir, { "model.executor": model });
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
  await saveWorkspaceConfig(projectDir, { "model.responder": model });
}
