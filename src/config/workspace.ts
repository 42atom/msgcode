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
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Workspace 配置（存储在 .msgcode/config.json）
 */
export interface WorkspaceConfig {
  // ==================== 记忆注入配置 ====================
  /** 记忆注入开关（默认 false） */
  "memory.inject.enabled"?: boolean;
  /** 记忆注入返回条数（默认 5） */
  "memory.inject.topK"?: number;
  /** 记忆注入最大字符数（默认 2000） */
  "memory.inject.maxChars"?: number;

  // ==================== M5: Codex 兼容配置 ====================
  /**
   * 策略模式：local-only（仅本地）或 egress-allowed（允许外联）
   * - local-only: 禁止使用需要外网的 runner（如 codex）
   * - egress-allowed: 允许使用所有 runner
   */
  "policy.mode"?: "local-only" | "egress-allowed";

  /**
   * 默认执行臂：mlx | lmstudio | codex | claude-code | llama | claude | openai
   * - mlx: MLX LM Server（GLM4.7 Flash MLX，工具闭环推荐）
   * - lmstudio: 本地 LM Studio 模型（兼容保留）
   * - llama: llama-server / llama.cpp（*.gguf 裸模型）
   * - claude: Anthropic Claude API
   * - openai: OpenAI API（GPT-4, o1, etc.）
   * - codex: Codex CLI（需要 egress-allowed）
   * - claude-code: Claude Code CLI（需要 egress-allowed）
   */
  "runner.default"?: "mlx" | "lmstudio" | "llama" | "claude" | "openai" | "codex" | "claude-code";

  // ==================== v2.2: Persona 配置 ====================
  /**
   * 当前激活的 persona ID（对应 .msgcode/personas/<id>.md）
   * - 留空表示不使用自定义 persona
   */
  "persona.active"?: string;

  // ==================== PI 配置 ====================
  /**
   * PI 开关（默认 false）
   */
  "pi.enabled"?: boolean;

  // ==================== Tool Bus 配置 ====================
  /**
   * 工具执行模式：explicit（默认稳态）、autonomous（可选）、tool-calls（预留）
   * - explicit: 只允许显式命令触发工具（/tts、/asr 等）
   * - autonomous: 模型可自主编排调用工具（含 shell/browser）
   * - tool-calls: 预留，标准 tool_calls 自动工具调用
   */
  "tooling.mode"?: ToolingMode;

  /**
   * 允许的工具列表
   * - 默认: ["tts", "asr", "vision"]
   */
  "tooling.allow"?: ToolName[];

  /**
   * 需要确认的工具列表
   * - 默认: ["shell", "browser"]
   */
  "tooling.require_confirm"?: ToolName[];

  // ==================== MLX Provider 配置 ====================
  /**
   * MLX LM Server 基础 URL
   * - 默认: http://127.0.0.1:18000
   */
  "mlx.baseUrl"?: string;

  /**
   * MLX 模型 ID
   * - 默认: 空（自动从 /v1/models 探测第一个）
   */
  "mlx.modelId"?: string;

  /**
   * MLX 最大 tokens
   * - 默认: 512
   */
  "mlx.maxTokens"?: number;

  /**
   * MLX 温度参数
   * - 默认: 0.7
   */
  "mlx.temperature"?: number;

  /**
   * MLX top_p 参数
   * - 默认: 1
   */
  "mlx.topP"?: number;
}

/**
 * 工具相关类型
 */
export type ToolingMode = "explicit" | "autonomous" | "tool-calls";
export type ToolName = "tts" | "asr" | "vision" | "mem" | "shell" | "browser" | "desktop";

/**
 * Workspace 配置的默认值
 */
const DEFAULT_WORKSPACE_CONFIG: Required<WorkspaceConfig> = {
  "memory.inject.enabled": false,
  "memory.inject.topK": 5,
  "memory.inject.maxChars": 2000,
  "policy.mode": "egress-allowed", // 默认允许外联（远程场景避免被门禁卡住；高敏 workspace 可手动切回 local-only）
  "runner.default": "lmstudio", // 默认使用本地模型
  "persona.active": "", // 默认不使用自定义 persona
  "pi.enabled": false, // 默认关闭 PI
  "tooling.mode": "autonomous", // P5.5: 测试期统一 autonomous（LLM 自主决策 tool_calls）
  "tooling.allow": ["tts", "asr", "vision"], // 默认允许基础工具
  "tooling.require_confirm": [], // 默认不要求确认
  // MLX Provider 默认值（Unsloth 稳态参数）
  "mlx.baseUrl": "http://127.0.0.1:18000",
  "mlx.modelId": "",
  "mlx.maxTokens": 2048,  // 降低空回复/finish_reason=length 概率
  "mlx.temperature": 0.7,
  "mlx.topP": 1,
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
// M5: Policy & Runner 配置
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
 * 获取默认执行臂
 *
 * @param projectDir 工作区路径
 * @returns 默认执行臂（mlx | lmstudio | llama | claude | openai | codex | claude-code）
 */
export async function getDefaultRunner(
  projectDir: string
): Promise<"mlx" | "lmstudio" | "llama" | "claude" | "openai" | "codex" | "claude-code"> {
  const workspaceConfig = await loadWorkspaceConfig(projectDir);
  return workspaceConfig["runner.default"] ?? DEFAULT_WORKSPACE_CONFIG["runner.default"];
}

/**
 * 设置默认执行臂
 *
 * @param projectDir 工作区路径
 * @param runner 默认执行臂
 * @param currentMode 当前策略模式（用于校验）
 * @returns { success: boolean, error?: string } 校验结果
 */
export async function setDefaultRunner(
  projectDir: string,
  runner: "mlx" | "lmstudio" | "llama" | "claude" | "openai" | "codex" | "claude-code",
  currentMode?: "local-only" | "egress-allowed"
): Promise<{ success: boolean; error?: string }> {
  // 如果没有提供 currentMode，读取当前配置
  if (!currentMode) {
    currentMode = await getPolicyMode(projectDir);
  }

  // M5-1: local-only 时禁止 codex/claude-code（需要外网访问）
  // 注意：claude/openai 也是远程 API，但当前仅在规划中，暂不校验
  if (currentMode === "local-only" && (runner === "codex" || runner === "claude-code")) {
    return {
      success: false,
      error: `当前策略模式为 local-only，不允许使用 ${runner}（需要外网访问）。\n\n` +
        `请先执行以下命令之一：\n` +
        `1. /policy on             （允许外网访问；等同 /policy egress-allowed）\n` +
        `2. /model lmstudio        （使用本地模型）\n` +
        `3. /model mlx             （使用 MLX LM Server）`,
    };
  }

  await saveWorkspaceConfig(projectDir, { "runner.default": runner });
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
// MLX Provider 配置
// ============================================

/**
 * MLX 配置接口
 */
export interface MlxConfig {
  baseUrl: string;
  modelId: string;
  maxTokens: number;
  temperature: number;
  topP: number;
}

/**
 * 获取 MLX 配置
 *
 * @param projectDir 工作区路径
 * @returns MLX 配置
 */
export async function getMlxConfig(
  projectDir: string
): Promise<MlxConfig> {
  const workspaceConfig = await loadWorkspaceConfig(projectDir);
  return {
    baseUrl: workspaceConfig["mlx.baseUrl"] ?? DEFAULT_WORKSPACE_CONFIG["mlx.baseUrl"],
    modelId: workspaceConfig["mlx.modelId"] ?? DEFAULT_WORKSPACE_CONFIG["mlx.modelId"],
    maxTokens: workspaceConfig["mlx.maxTokens"] ?? DEFAULT_WORKSPACE_CONFIG["mlx.maxTokens"],
    temperature: workspaceConfig["mlx.temperature"] ?? DEFAULT_WORKSPACE_CONFIG["mlx.temperature"],
    topP: workspaceConfig["mlx.topP"] ?? DEFAULT_WORKSPACE_CONFIG["mlx.topP"],
  };
}

/**
 * 设置 MLX 配置
 *
 * @param projectDir 工作区路径
 * @param config MLX 配置（部分更新）
 */
export async function setMlxConfig(
  projectDir: string,
  config: Partial<MlxConfig>
): Promise<void> {
  const partial: Partial<WorkspaceConfig> = {};

  if (config.baseUrl !== undefined) partial["mlx.baseUrl"] = config.baseUrl;
  if (config.modelId !== undefined) partial["mlx.modelId"] = config.modelId;
  if (config.maxTokens !== undefined) partial["mlx.maxTokens"] = config.maxTokens;
  if (config.temperature !== undefined) partial["mlx.temperature"] = config.temperature;
  if (config.topP !== undefined) partial["mlx.topP"] = config.topP;

  await saveWorkspaceConfig(projectDir, partial);
}
