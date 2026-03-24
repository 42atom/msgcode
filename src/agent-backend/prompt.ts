/**
 * msgcode: Agent Backend 提示词构建模块
 *
 * P5.7-R9-T7: 从 lmstudio.ts 迁移出的提示词构建逻辑
 * 目标：分离提示词构建与执行逻辑
 *
 * 提示词分类：
 * - Dialog: 对话链路（允许 SOUL 注入）
 * - Exec: 执行链路（禁止 SOUL 注入，保持协议化）
 */

import * as path from "node:path";
import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as os from "node:os";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { logger } from "../logger/index.js";
import { MODEL_ALIAS_SET } from "./config.js";
import type { ConflictMode } from "../config/workspace.js";

// ============================================
// 提示词常量
// ============================================

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, "..", "..");

export const DEFAULT_PROMPT_FRAGMENT_DIR = path.resolve(REPO_ROOT, "prompts", "fragments");
export const MCP_ANTI_LOOP_RULES_FILE = path.resolve(
    DEFAULT_PROMPT_FRAGMENT_DIR,
    "mcp-anti-loop.md"
);
export const QUICK_ANSWER_CONSTRAINT_FILE = path.resolve(
    DEFAULT_PROMPT_FRAGMENT_DIR,
    "quick-answer-constraint.md"
);
export const EXEC_TOOL_PROTOCOL_CONSTRAINT_FILE = path.resolve(
    DEFAULT_PROMPT_FRAGMENT_DIR,
    "exec-tool-protocol-constraint.md"
);
export const CONFLICT_MODE_FULL_FILE = path.resolve(
    DEFAULT_PROMPT_FRAGMENT_DIR,
    "conflict-mode-full.md"
);
export const CONFLICT_MODE_ASSISTED_FILE = path.resolve(
    DEFAULT_PROMPT_FRAGMENT_DIR,
    "conflict-mode-assisted.md"
);

/**
 * Agent Backend 文本默认模型（缺省配置时优先尝试）
 */
export const AGENT_BACKEND_DEFAULT_CHAT_MODEL = "huihui-glm-4.7-flash-abliterated-mlx";

/**
 * @deprecated 请使用 AGENT_BACKEND_DEFAULT_CHAT_MODEL
 */
export const LMSTUDIO_DEFAULT_CHAT_MODEL = AGENT_BACKEND_DEFAULT_CHAT_MODEL;

/**
 * 系统提示词文件默认路径（可热调试）
 */
export const DEFAULT_SYSTEM_PROMPT_FILE = path.resolve(
    REPO_ROOT,
    "prompts",
    "agents-prompt.md"
);

// ============================================
// 辅助函数
// ============================================

/**
 * 防止系统提示词文件加载失败日志刷屏
 */
const PROMPT_FILE_WARNED = new Set<string>();

function loadPromptFragmentSync(filePath: string): string {
    try {
        return fs.readFileSync(filePath, "utf-8").trim();
    } catch (error) {
        if (!PROMPT_FILE_WARNED.has(filePath)) {
            logger.warn("Agent backend prompt fragment load failed", {
                module: "agent-backend/prompt",
                promptFragmentPath: filePath,
                error: error instanceof Error ? error.message : String(error),
            });
            PROMPT_FILE_WARNED.add(filePath);
        }
        return "";
    }
}

/**
 * MCP 防循环规则（硬约束）
 */
export const MCP_ANTI_LOOP_RULES = loadPromptFragmentSync(MCP_ANTI_LOOP_RULES_FILE);

/**
 * 快速回答规则（E17：默认启用，避免模型思考太长时间）
 */
export const QUICK_ANSWER_CONSTRAINT = loadPromptFragmentSync(QUICK_ANSWER_CONSTRAINT_FILE);

/**
 * Exec Kernel 工具协议硬约束
 *
 * 目标：
 * - 执行核只负责产出 tool_calls，不输出"我将执行/我可以"等自然语言。
 * - 降低模型在工具路由里回到闲聊文本的概率。
 */
export const EXEC_TOOL_PROTOCOL_CONSTRAINT = loadPromptFragmentSync(
    EXEC_TOOL_PROTOCOL_CONSTRAINT_FILE
);
export const CONFLICT_MODE_FULL_CONSTRAINT = loadPromptFragmentSync(CONFLICT_MODE_FULL_FILE);
export const CONFLICT_MODE_ASSISTED_CONSTRAINT = loadPromptFragmentSync(CONFLICT_MODE_ASSISTED_FILE);

export const READ_FILE_PREVIEW_CONSTRAINT =
    "若 read_file 的 tool_result 预览里出现 [lastNonEmptyLine]，它就是该文件尾部最后一条非空行；回答尾行/最后一行类问题时优先直接使用这条事实，不要把 [EOF] 当成正文内容。";

export const FILE_FACT_VERIFICATION_CONSTRAINT =
    "若用户在问当前工作目录里的文件内容、最后一行、尾行、摘要、行号或某段文本，你本轮必须先调用 read_file 或 bash 实际读取，再回答具体文件事实；未读文件前，禁止直接给出这些内容。";

export const IMAGE_FOLLOWUP_FACT_REUSE_CONSTRAINT =
    "若用户在追问同一张图片、截图或报告，而最近对话窗口里已经有附件信息、[图片摘要]或上一轮图像分析结论，优先复用这些已提取事实继续回答；不要仅因为本轮没有新附件就回退成“我没有视觉能力”。";

export const IMAGE_FILE_READ_CONSTRAINT =
    "png/jpg/jpeg/webp 等图片文件不是 read_file 的目标；不要用 read_file 读取图片本体。若需要新图像细节，优先走现有视觉能力；若当前上下文里只有旧图像事实且仍不足以回答，再明确要求用户补发截图或贴出文本。";

/**
 * 归一化模型覆盖值：
 * - 空字符串/别名返回 undefined（触发自动模型解析）
 * - 其他值按真实模型 ID 透传
 */
export function normalizeModelOverride(model?: string): string | undefined {
    const normalized = (model || "").trim();
    if (!normalized) return undefined;
    if (MODEL_ALIAS_SET.has(normalized.toLowerCase())) return undefined;
    return normalized;
}

/**
 * 解析提示词文件路径
 */
export function resolvePromptFilePath(filePath?: string): string {
    const normalized = (filePath || "").trim();
    const candidate = normalized || DEFAULT_SYSTEM_PROMPT_FILE;
    return path.isAbsolute(candidate) ? candidate : path.resolve(REPO_ROOT, candidate);
}

/**
 * 从文件加载系统提示词
 */
export async function loadSystemPromptFromFile(filePath?: string): Promise<string> {
    const resolvedPath = resolvePromptFilePath(filePath);
    try {
        let content = await fsPromises.readFile(resolvedPath, "utf-8");
        // 注入运行时路径占位符
        content = injectRuntimePaths(content);
        return content.trim();
    } catch (error) {
        if (!PROMPT_FILE_WARNED.has(resolvedPath)) {
            logger.warn("Agent backend system prompt file load failed", {
                module: "agent-backend/prompt",
                promptFilePath: resolvedPath,
                error: error instanceof Error ? error.message : String(error),
            });
            PROMPT_FILE_WARNED.add(resolvedPath);
        }
        return "";
    }
}

/**
 * 注入运行时路径到提示词模板
 *
 * 占位符规则：
 * - {{MSGCODE_CONFIG_DIR}} -> ~/.config/msgcode 展开为真实绝对路径
 * - {{MSGCODE_SKILLS_DIR}} -> ~/.config/msgcode/skills 展开为真实绝对路径
 */
function injectRuntimePaths(content: string): string {
    // 复用配置目录主链 (与 src/runtime/singleton.ts 一致)
    const configDir = process.env.MSGCODE_CONFIG_DIR ?? path.join(os.homedir(), ".config", "msgcode");
    const skillsDir = path.join(configDir, "skills");

    return content
        .replace(/\{\{MSGCODE_CONFIG_DIR\}\}/g, configDir)
        .replace(/\{\{MSGCODE_SKILLS_DIR\}\}/g, skillsDir);
}

/**
 * 解析基础系统提示词
 *
 * 优先级：
 * 1. 传入的 systemOverride 参数
 * 2. 配置文件中的 agentSystemPrompt
 * 3. 从文件加载（agentSystemPromptFile）
 */
export async function resolveBaseSystemPrompt(systemOverride?: string): Promise<string> {
    const directPrompt = (systemOverride || "").trim();
    if (directPrompt) return directPrompt;

    const envPrompt = (config.agentSystemPrompt || "").trim();
    if (envPrompt) return envPrompt;

    return await loadSystemPromptFromFile(config.agentSystemPromptFile);
}

// ============================================
// System Prompt 构建函数
// ============================================

/**
 * Dialog Kernel 专用 system prompt 构建函数
 *
 * 用于对话链路（kernel=dialog），允许注入 SOUL 上下文。
 *
 * @param base 基础 system prompt（用户配置）
 * @param useMcp 是否启用 MCP
 * @param soulContext SOUL 上下文（可选）
 * @returns 完整的 system prompt
 */
export function buildDialogSystemPrompt(
    base: string,
    useMcp: boolean,
    soulContext?: { content: string; source: string },
    conflictMode: ConflictMode = "full"
): string {
    const parts: string[] = [];

    // 1. 基础 prompt
    if (base.trim()) {
        parts.push(base.trim());
    }

    // 2. 快速回答规则
    parts.push(QUICK_ANSWER_CONSTRAINT);

    // 3. MCP 规则（可选）
    if (useMcp) {
        parts.push(MCP_ANTI_LOOP_RULES);
    }

    // 4. 冲突处置姿态
    const conflictModeConstraint = resolveConflictModeConstraint(conflictMode);
    if (conflictModeConstraint) {
        parts.push(conflictModeConstraint);
    }

    // 5. SOUL 上下文（仅 dialog 链路允许注入）
    if (soulContext && soulContext.source !== "none") {
        parts.push(`\n\n[灵魂身份]\n${soulContext.content}\n[/灵魂身份]`);
        parts.push(`（SOUL 已内置到系统提示中，你不需要也不应该尝试读取"灵魂文件"或"灵魂脚本"）`);
    }

    return parts.join("\n\n");
}

/**
 * Exec Kernel 专用 system prompt 构建函数
 *
 * 用于执行链路（kernel=exec），禁止注入 SOUL 上下文。
 *
 * @param base 基础 system prompt（用户配置）
 * @param useMcp 是否启用 MCP
 * @returns 完整的 system prompt（不含 SOUL）
 */
export function buildExecSystemPrompt(
    base: string,
    useMcp: boolean,
    conflictMode: ConflictMode = "full"
): string {
    const parts: string[] = [];

    // 1. 基础 prompt
    if (base.trim()) {
        parts.push(base.trim());
    }

    // 2. 执行核协议（禁止自然语言直答）
    parts.push(EXEC_TOOL_PROTOCOL_CONSTRAINT);
    parts.push(READ_FILE_PREVIEW_CONSTRAINT);
    parts.push(FILE_FACT_VERIFICATION_CONSTRAINT);
    parts.push(IMAGE_FOLLOWUP_FACT_REUSE_CONSTRAINT);
    parts.push(IMAGE_FILE_READ_CONSTRAINT);

    // 3. MCP 规则（可选）
    if (useMcp) {
        parts.push(MCP_ANTI_LOOP_RULES);
    }

    const conflictModeConstraint = resolveConflictModeConstraint(conflictMode);
    if (conflictModeConstraint) {
        parts.push(conflictModeConstraint);
    }

    // 注意：exec 链路禁止注入 SOUL，保持提示词最小且协议化

    return parts.join("\n\n");
}

function resolveConflictModeConstraint(mode: ConflictMode): string {
    if (mode === "assisted") {
        return CONFLICT_MODE_ASSISTED_CONSTRAINT;
    }
    return CONFLICT_MODE_FULL_CONSTRAINT;
}

export type { ConversationContextBudget } from "../runtime/context-policy.js";
export {
    DEFAULT_CONVERSATION_CONTEXT_BUDGET,
    buildConversationContextBlocks,
    buildDialogPromptWithContext,
} from "../runtime/context-policy.js";
