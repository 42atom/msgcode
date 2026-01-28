/**
 * msgcode: 获取 iMessage 群组列表工具
 *
 * 用途：获取所有 iMessage 群组及其 chatId，用于配置 .env
 * 运行：npm run get-chats 或 tsx scripts/get-chats.ts
 *
 * 功能：
 * - 列出所有群组和个人对话
 * - 显示 chatId 和最后消息
 * - 生成 .env 配置示例
 * - 支持项目目录映射
 */

import { IMessageSDK } from "@photon-ai/imessage-kit";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const execAsync = promisify(exec);

// ANSI 颜色
const colors = {
    reset: "\x1b[0m",
    bright: "\x1b[1m",
    dim: "\x1b[2m",
    green: "\x1b[32m",
    blue: "\x1b[34m",
    yellow: "\x1b[33m",
    cyan: "\x1b[36m",
    red: "\x1b[31m",
};

interface ChatInfo {
    id: string;
    name: string;
    lastMessage?: string;
    count: number;
    isGroup: boolean;
    service: string;
}

/**
 * 使用 AppleScript 获取群组名称（更准确）
 */
async function getGroupNames(): Promise<Map<string, string>> {
    try {
        const script = `
tell application "Messages"
    set chatList to every chat
    set resultText to ""
    repeat with currentChat in chatList
        try
            set chatId to id of currentChat
            set chatName to name of currentChat
            if chatName is missing value then
                set chatName to ""
            end if
            set resultText to resultText & chatId & ":::" & chatName & "\\n"
        end try
    end repeat
    return resultText
end tell
`.trim();

        const { stdout } = await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
        const nameMap = new Map<string, string>();

        for (const line of stdout.trim().split("\n")) {
            const [id, name] = line.split(":::");
            if (id && name) {
                nameMap.set(id, name);
            }
        }

        return nameMap;
    } catch {
        return new Map();
    }
}

/**
 * 生成群组名称（用于环境变量）
 */
function generateEnvName(chatName: string, chatId: string): string {
    // 优先使用群组名
    let name = chatName || chatId;

    // 转换为适合环境变量的格式
    name = name
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "_") // 支持中文
        .replace(/^_+|_+$/g, "");

    // 如果太短，使用部分 chatId
    if (name.length < 3) {
        name = "group_" + chatId.slice(0, 6);
    }

    return name.toUpperCase();
}

/**
 * 格式化服务类型
 */
function formatService(service: string): string {
    const map: Record<string, string> = {
        iMessage: "i",
        SMS: "S",
        RCS: "R",
    };
    return map[service] || service[0] || "?";
}

/**
 * 获取当前 .env 配置
 */
function getCurrentEnvConfig(): Map<string, string> {
    try {
        // 优先读取用户配置：~/.config/msgcode/.env；没有则回退到当前目录 .env
        const preferredPath =
            process.env.MSGCODE_ENV_PATH ||
            path.join(os.homedir(), ".config/msgcode/.env");
        const fallbackPath = path.join(process.cwd(), ".env");
        const envPath = existsSync(preferredPath) ? preferredPath : fallbackPath;
        const content = readFileSync(envPath, "utf-8");
        const config = new Map<string, string>();

        for (const line of content.split("\n")) {
            const match = line.match(/^GROUP_([A-Z_0-9]+)=(.+)$/);
            if (match) {
                config.set(match[1], match[2]);
            }
        }

        return config;
    } catch {
        return new Map();
    }
}

async function main() {
    console.log(`${colors.bright}${colors.blue}══════════════════════════════════════════${colors.reset}`);
    console.log(`${colors.bright}${colors.blue}      msgcode: 群组配置工具           ${colors.reset}`);
    console.log(`${colors.bright}${colors.blue}══════════════════════════════════════════${colors.reset}\n`);

    const sdk = new IMessageSDK({ debug: false });

    try {
        // 1. 获取 AppleScript 群组名称
        console.log(`${colors.dim}📡 正在通过 AppleScript 获取群组信息...${colors.reset}`);
        const groupNames = await getGroupNames();
        if (groupNames.size > 0) {
            console.log(`${colors.green}✓${colors.reset} 找到 ${groupNames.size} 个群组\n`);
        }

        // 2. 获取 SDK 消息
        console.log(`${colors.dim}📬 正在获取消息列表...${colors.reset}`);
        const result = await sdk.getMessages({ limit: 300 });

        // 3. 整合信息
        const chatMap = new Map<string, ChatInfo>();

        for (const msg of result.messages) {
            if (!chatMap.has(msg.chatId)) {
                const appleScriptName = groupNames.get(msg.chatId);
                const isGroup = msg.isGroupChat || false;

                chatMap.set(msg.chatId, {
                    id: msg.chatId,
                    name: appleScriptName || msg.senderName || msg.sender || msg.chatId,
                    lastMessage: msg.text?.substring(0, 40) || "",
                    count: 1,
                    isGroup,
                    service: msg.service,
                });
            } else {
                const chat = chatMap.get(msg.chatId)!;
                chat.count++;
                if (msg.text) {
                    chat.lastMessage = msg.text.substring(0, 40);
                }
            }
        }

        // 4. 获取当前配置
        const currentConfig = getCurrentEnvConfig();

        // 5. 分类显示
        const groups: ChatInfo[] = [];
        const dms: ChatInfo[] = [];

        for (const info of chatMap.values()) {
            if (info.isGroup) {
                groups.push(info);
            } else {
                dms.push(info);
            }
        }

        // 按消息数量排序
        groups.sort((a, b) => b.count - a.count);

        // 6. 打印群组
        console.log(`${colors.bright}${colors.yellow}══════════════════════════════════════════${colors.reset}`);
        console.log(`${colors.bright}${colors.yellow}  📁 群组 (${groups.length} 个)${colors.reset}`);
        console.log(`${colors.bright}${colors.yellow}══════════════════════════════════════════${colors.reset}\n`);

        if (groups.length > 0) {
            for (let i = 0; i < groups.length; i++) {
                const item = groups[i];
                const envName = generateEnvName(item.name, item.id);
                const isConfigured = currentConfig.has(envName);
                const statusIcon = isConfigured
                    ? `${colors.green}✓${colors.reset}`
                    : `${colors.dim}○${colors.reset}`;

                console.log(`${colors.bright}${i + 1}. ${statusIcon} ${colors.cyan}${item.name}${colors.reset}${colors.dim} [${formatService(item.service)}]${colors.reset}`);
                console.log(`   ${colors.dim}chatId: ${item.id}${colors.reset}`);
                console.log(`   ${colors.dim}消息数: ${item.count} | 最后: "${item.lastMessage}"${colors.reset}`);
                console.log(`   ${colors.dim}环境变量名: GROUP_${envName}${colors.reset}`);
                console.log("");
            }
        } else {
            console.log(`${colors.yellow}⚠️  未找到群组，请先在 iMessage 中创建群组${colors.reset}\n`);
        }

        // 7. 打印个人对话（前3个）
        if (dms.length > 0) {
            console.log(`${colors.bright}${colors.yellow}══════════════════════════════════════════${colors.reset}`);
            console.log(`${colors.bright}${colors.yellow}  💬 个人对话 (显示前 3 个，共 ${dms.length} 个)${colors.reset}`);
            console.log(`${colors.bright}${colors.yellow}══════════════════════════════════════════${colors.reset}\n`);

            dms.slice(0, 3).forEach((item, i) => {
                console.log(`  ${colors.bright}${i + 1}.${colors.reset} ${colors.green}${item.name}${colors.reset} ${colors.dim}[${formatService(item.service)}]${colors.reset}`);
                console.log(`     ${colors.dim}chatId: ${item.id}${colors.reset}`);
            });
            console.log("");
        }

        // 8. 输出配置建议
        if (groups.length > 0) {
            console.log(`${colors.bright}${colors.cyan}══════════════════════════════════════════${colors.reset}`);
            console.log(`${colors.bright}${colors.cyan}  📋 .env 配置示例${colors.reset}`);
            console.log(`${colors.bright}${colors.cyan}══════════════════════════════════════════${colors.reset}\n`);
            console.log(`${colors.dim}# 格式: GROUP_<名称>=<chatId>[:<项目目录>[:<bot类型>]]${colors.reset}`);
            console.log(`${colors.dim}# bot类型: code | image | file | default (默认)${colors.reset}\n`);

            for (const item of groups) {
                const envName = generateEnvName(item.name, item.id);
                const isConfigured = currentConfig.has(envName);
                const prefix = isConfigured ? `${colors.green}✓${colors.reset} ` : `  `;
                console.log(`${prefix}GROUP_${envName}=${item.id}:/Users/<you>/path/to/your_project`);
            }
            console.log("");
        }

        // 9. 已配置的群组
        if (currentConfig.size > 0) {
            console.log(`${colors.bright}${colors.green}══════════════════════════════════════════${colors.reset}`);
            console.log(`${colors.bright}${colors.green}  ✅ 当前已配置 (${currentConfig.size} 个)${colors.reset}`);
            console.log(`${colors.bright}${colors.green}══════════════════════════════════════════${colors.reset}\n`);

            for (const [name, value] of currentConfig.entries()) {
                const [chatId, projectDir, botType] = value.split(":");
                console.log(`  ${colors.green}GROUP_${name}${colors.reset}`);
                console.log(`     ${colors.dim}chatId: ${chatId}${colors.reset}`);
                if (projectDir) {
                    console.log(`     ${colors.dim}目录: ${projectDir}${colors.reset}`);
                }
                if (botType) {
                    console.log(`     ${colors.dim}类型: ${botType}${colors.reset}`);
                }
            }
            console.log("");
        }

    } catch (error: any) {
        console.error(`${colors.red}❌ 错误: ${error.message}${colors.reset}`);
        if (error.message?.includes("Full Disk Access") || error.message?.includes("Operation denied")) {
            console.error(`\n${colors.yellow}⚠️  需要授予 Full Disk Access 权限${colors.reset}`);
            console.error(`${colors.dim}系统设置 → 隐私与安全性 → 完全磁盘访问权限 → 添加 终端 或 iTerm${colors.reset}`);
        }
    } finally {
        await sdk.close();
    }
}

main().catch(console.error);
