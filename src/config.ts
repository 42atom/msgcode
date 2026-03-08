/**
 * msgcode: 配置加载模块
 *
 * 从 .env 文件加载配置，提供类型安全的配置访问
 *
 * 配置优先级：
 * 1. ~/.config/msgcode/.env（用户配置，优先）
 * 2. 项目根目录 .env（项目配置，后备）
 * 3. 环境变量（系统环境，兜底）
 */

import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { logger } from "./logger/index.js";

/**
 * 获取配置文件路径
 *
 * 优先级：用户配置目录 → 项目根目录
 */
function getConfigPath(): string {
    // 用户配置目录：~/.config/msgcode/.env
    const userConfig = path.join(os.homedir(), ".config/msgcode/.env");

    // 项目配置：项目根目录/.env
    const projectConfig = path.join(process.cwd(), ".env");

    // 优先使用用户配置
    if (fs.existsSync(userConfig)) {
        return userConfig;
    }

    // 回退到项目配置
    if (fs.existsSync(projectConfig)) {
        logger.warn("使用项目配置文件，建议迁移到 ~/.config/msgcode/.env");
        return projectConfig;
    }

    // 都不存在，返回用户配置路径（让 dotenv 报错，更清晰）
    return userConfig;
}

// 加载 .env（使用优先级路径）
const configPath = getConfigPath();
dotenv.config({ path: configPath });

/**
 * 群组配置
 */
export interface GroupConfig {
    chatId: string;
    projectDir?: string;
    botType?: string;
}

/**
 * 白名单配置
 */
export interface WhitelistConfig {
    phones: string[];
    emails: string[];
}

/**
 * 完整配置
 */
export interface Config {
    // Transport 列表（启动时启用哪些通道）
    // - 默认：imsg
    // - 若配置 FEISHU_APP_ID/FEISHU_APP_SECRET：自动追加 feishu（可用 MSGCODE_TRANSPORTS 显式覆盖）
    transports: ("imsg" | "feishu")[];
    // 白名单
    whitelist: WhitelistConfig;
    // 群组路由：群组名 → 配置
    groupRoutes: Map<string, GroupConfig>;
    // 日志级别
    logLevel: "debug" | "info" | "warn" | "error";
    // imsg 二进制路径（2.0 唯一 iMessage Provider）
    imsgPath?: string;
    // imsg 数据库路径 (可选)
    imsgDbPath?: string;
    // 工作空间根目录（E08 新增）
    workspaceRoot: string;
    // 未绑定 chat 的默认工作目录名（相对 WORKSPACE_ROOT）
    defaultWorkspaceDir: string;
    // LM Studio 本地 API Base URL（Local Server），默认: http://127.0.0.1:1234
    lmstudioBaseUrl?: string;
    // LM Studio 模型名（可选）
    lmstudioModel?: string;
    // Agent System Prompt（可选）
    agentSystemPrompt?: string;
    // Agent System Prompt 文件路径（可选）
    agentSystemPromptFile?: string;
    // LM Studio 请求超时（毫秒），默认: 120000
    lmstudioTimeoutMs?: number;
    // LM Studio 最大输出 token（可选，默认: 4000）
    lmstudioMaxTokens?: number;
    // LM Studio API Key（可选，服务端需要授权时使用）
    lmstudioApiKey?: string;
    // 结束前最小监督闭环配置
    supervisor: {
        enabled: boolean;
        temperature: number;
        maxTokens: number;
    };
    // 群聊安全：仅允许 owner 触发（可选，默认 false）
    ownerOnlyInGroup: boolean;
    // owner 身份标识（电话/邮箱 handle），用于群聊收口信任边界
    // 逗号分隔：MSGCODE_OWNER=wan2011@me.com,+8613800...
    ownerIdentifiers: string[];

    // Feishu（飞书）Bot 配置（MVP）
    feishu?: {
        appId: string;
        appSecret: string;
        encryptKey?: string;
        // 冒烟期开关：允许飞书消息绕过白名单（默认 false）
        allowAll: boolean;
    };
}

function parseCsv(value: string | undefined): string[] {
    if (!value) return [];
    return value
        .split(",")
        .map(s => s.trim())
        .filter(Boolean);
}

function parseBool(value: string | undefined): boolean {
    if (!value) return false;
    return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function parseNumber(value: string | undefined, fallback: number): number {
    if (!value) return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return parsed;
}

function parseTransports(): ("imsg" | "feishu")[] {
    const raw = (process.env.MSGCODE_TRANSPORTS || "").trim();
    if (raw) {
        const items = raw
            .split(",")
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean);
        const out: ("imsg" | "feishu")[] = [];
        for (const it of items) {
            if (it === "imsg" || it === "feishu") {
                if (!out.includes(it)) out.push(it);
            }
        }
        // 兜底：空配置不允许（避免“启动了但没 transport”）
        return out.length > 0 ? out : ["imsg"];
    }

    // 默认：imsg；若 feishu 配置齐全则自动追加
    const out: ("imsg" | "feishu")[] = ["imsg"];
    if ((process.env.FEISHU_APP_ID || "").trim() && (process.env.FEISHU_APP_SECRET || "").trim()) {
        out.push("feishu");
    }
    return out;
}

function parseDefaultWorkspaceDir(): string {
    const raw = (process.env.MSGCODE_DEFAULT_WORKSPACE_DIR || "").trim();
    const dir = raw || "default";
    // 仅允许相对路径片段（与 /bind 一致：禁止 /、..、~）
    if (dir.startsWith("/") || dir.includes("..") || dir.includes("~")) {
        throw new Error("MSGCODE_DEFAULT_WORKSPACE_DIR 必须是相对路径（不能以 / 开头，不能包含 .. 或 ~）");
    }
    return dir;
}

/**
 * 解析电话号码列表
 */
function parsePhones(value: string | undefined): string[] {
    if (!value) return [];
    return value.split(",").map(s => s.trim()).filter(Boolean);
}

/**
 * 解析邮箱列表
 */
function parseEmails(value: string | undefined): string[] {
    if (!value) return [];
    return value.split(",").map(s => s.trim()).filter(Boolean);
}

/**
 * 解析群组配置
 * 格式: GROUP_<名称>=<chatId>[:<项目目录>[:<bot类型>]]
 */
function parseGroupConfig(value: string): GroupConfig {
    const parts = value.split(":");
    return {
        chatId: parts[0],
        projectDir: parts[1],
        botType: parts[2],
    };
}

/**
 * 解析群组路由配置
 */
function parseGroupRoutes(): Map<string, GroupConfig> {
    const routes = new Map<string, GroupConfig>();

    for (const [key, value] of Object.entries(process.env)) {
        if (key.startsWith("GROUP_") && value) {
            const name = key.replace("GROUP_", "").toLowerCase();
            routes.set(name, parseGroupConfig(value));
        }
    }

    return routes;
}

/**
 * 加载配置
 */
export function loadConfig(): Config {
    const isTest = process.env.NODE_ENV === "test";

    const transports = parseTransports();

    const phones = parsePhones(process.env.MY_PHONE);
    const emails = parseEmails(process.env.MY_EMAIL);
    const ownerOnlyInGroup = parseBool(process.env.MSGCODE_OWNER_ONLY_IN_GROUP);
    const ownerIdentifiers = parseCsv(process.env.MSGCODE_OWNER);
    const supervisorEnabled = process.env.SUPERVISOR_ENABLED
        ? parseBool(process.env.SUPERVISOR_ENABLED)
        : !isTest;
    const supervisorTemperature = parseNumber(process.env.SUPERVISOR_TEMPERATURE, 0.1);
    const supervisorMaxTokens = Math.max(32, Math.floor(parseNumber(process.env.SUPERVISOR_MAX_TOKENS, 300)));

    const groupRoutes = parseGroupRoutes();

    // 测试环境：不要求真实用户白名单（避免 CI / 本地跑测依赖个人配置）
    if (!isTest) {
        if (phones.length === 0 && emails.length === 0) {
            throw new Error("白名单为空 (MY_PHONE / MY_EMAIL)，为安全起见请至少配置一项");
        }
        if (ownerOnlyInGroup && ownerIdentifiers.length === 0) {
            throw new Error("已启用群聊 owner 收口 (MSGCODE_OWNER_ONLY_IN_GROUP=1)，但未配置 MSGCODE_OWNER");
        }
    }

    const enableImsg = transports.includes("imsg");
    const enableFeishu = transports.includes("feishu");

    const imsgPath = (process.env.IMSG_PATH || "").trim() || undefined;
    if (enableImsg && !imsgPath) {
        throw new Error("未设置 IMSG_PATH（已启用 imsg transport）");
    }

    const feishuAppId = (process.env.FEISHU_APP_ID || "").trim();
    const feishuAppSecret = (process.env.FEISHU_APP_SECRET || "").trim();
    const feishuEncryptKey = (process.env.FEISHU_ENCRYPT_KEY || "").trim();
    const feishuAllowAll = parseBool(process.env.FEISHU_ALLOW_ALL);

    if (enableFeishu && (!feishuAppId || !feishuAppSecret)) {
        throw new Error("已启用 feishu transport，但未配置 FEISHU_APP_ID / FEISHU_APP_SECRET");
    }
    if (!enableImsg && !enableFeishu) {
        throw new Error("未启用任何 transport（MSGCODE_TRANSPORTS 为空）");
    }

    return {
        transports,
        whitelist: {
            phones: isTest && phones.length === 0 ? ["+10000000000"] : phones,
            emails: isTest && emails.length === 0 ? ["test@example.com"] : emails,
        },
        groupRoutes,
        logLevel: (process.env.LOG_LEVEL as Config["logLevel"]) || "info",
        imsgPath,
        imsgDbPath: process.env.IMSG_DB_PATH || `${process.env.HOME}/Library/Messages/chat.db`,
        // E08: 工作空间根目录配置
        workspaceRoot: process.env.WORKSPACE_ROOT || path.join(os.homedir(), "msgcode-workspaces"),
        defaultWorkspaceDir: parseDefaultWorkspaceDir(),
        lmstudioBaseUrl: process.env.LMSTUDIO_BASE_URL,
        lmstudioModel: process.env.LMSTUDIO_MODEL,
        agentSystemPrompt: process.env.AGENT_SYSTEM_PROMPT,
        agentSystemPromptFile: process.env.AGENT_SYSTEM_PROMPT_FILE,
        lmstudioTimeoutMs: process.env.LMSTUDIO_TIMEOUT_MS ? Number(process.env.LMSTUDIO_TIMEOUT_MS) : undefined,
        lmstudioMaxTokens: process.env.LMSTUDIO_MAX_TOKENS ? Number(process.env.LMSTUDIO_MAX_TOKENS) : undefined,
        lmstudioApiKey: process.env.LMSTUDIO_API_KEY,
        supervisor: {
            enabled: supervisorEnabled,
            temperature: supervisorTemperature,
            maxTokens: supervisorMaxTokens,
        },
        ownerOnlyInGroup: isTest ? false : ownerOnlyInGroup,
        ownerIdentifiers: isTest ? ["test@example.com"] : ownerIdentifiers,
        ...(enableFeishu
            ? {
                feishu: {
                    appId: feishuAppId,
                    appSecret: feishuAppSecret,
                    encryptKey: feishuEncryptKey || undefined,
                    allowAll: feishuAllowAll,
                },
            }
            : {}),
    };
}

/**
 * 全局配置实例
 */
export const config = loadConfig();

/**
 * 检查是否在白名单中
 */
export function isWhitelisted(identifier: string): boolean {
    const { whitelist } = config;

    // 检查电话号码（支持多种格式）
    for (const phone of whitelist.phones) {
        const normalizedPhone = phone.replace(/\D/g, ""); // 移除非数字
        const normalizedIdentifier = identifier.replace(/\D/g, "");
        if (normalizedIdentifier.includes(normalizedPhone) || normalizedPhone.includes(normalizedIdentifier)) {
            return true;
        }
    }

    // 检查邮箱
    for (const email of whitelist.emails) {
        if (identifier.toLowerCase() === email.toLowerCase()) {
            return true;
        }
    }

    return false;
}
