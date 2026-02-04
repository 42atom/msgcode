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
   * 默认执行臂：lmstudio | codex | claude-code
   * - lmstudio: 本地 LM Studio 模型（默认）
   * - codex: Codex CLI（需要 egress-allowed）
   * - claude-code: Claude Code CLI（需要 egress-allowed）
   */
  "runner.default"?: "lmstudio" | "codex" | "claude-code";

  // ==================== v2.2: Persona 配置 ====================
  /**
   * 当前激活的 persona ID（对应 .msgcode/personas/<id>.md）
   * - 留空表示不使用自定义 persona
   */
  "persona.active"?: string;
}

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
 * @returns 默认执行臂（lmstudio | codex | claude-code）
 */
export async function getDefaultRunner(
  projectDir: string
): Promise<"lmstudio" | "codex" | "claude-code"> {
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
  runner: "lmstudio" | "codex" | "claude-code",
  currentMode?: "local-only" | "egress-allowed"
): Promise<{ success: boolean; error?: string }> {
  // 如果没有提供 currentMode，读取当前配置
  if (!currentMode) {
    currentMode = await getPolicyMode(projectDir);
  }

  // M5-1: local-only 时禁止 codex/claude-code
  if (currentMode === "local-only" && (runner === "codex" || runner === "claude-code")) {
    return {
      success: false,
      error: `当前策略模式为 local-only，不允许使用 ${runner}（需要外网访问）。\n\n` +
        `请先执行以下命令之一：\n` +
        `1. /policy egress-allowed  （允许外网访问）\n` +
        `2. /model lmstudio        （使用本地模型）`,
    };
  }

  await saveWorkspaceConfig(projectDir, { "runner.default": runner });
  return { success: true };
}
