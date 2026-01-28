#!/usr/bin/env node
/**
 * msgcode: CLI 入口
 *
 * 独立命令行工具，管理 msgcode bot
 */

import { Command } from "commander";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, copyFile } from "node:fs/promises";
import { existsSync, accessSync, constants } from "node:fs";
import { exec, spawn } from "node:child_process";

// 获取 CLI 模块自身路径（ESM 模块）
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CONFIG_DIR = path.join(os.homedir(), ".config/msgcode");
const LOG_DIR = path.join(CONFIG_DIR, "log");
const LOG_FILE = path.join(LOG_DIR, "msgcode.log");
const DAEMON_SCRIPT = path.join(__dirname, "daemon.ts");

const program = new Command();

program
    .name("msgcode")
    .description("msgcode - iMessage-based AI Bot CLI")
    .version("0.2.0");

program
    .command("start [mode]")
    .description("启动 msgcode bot（debug 模式下前台输出日志）")
    .action(async (mode: string | undefined) => {
        const normalized = (mode ?? "").toLowerCase();
        if (normalized === "debug") {
            const { startBot } = await import("./commands.js");
            await startBot();
            return;
        }
        await launchDaemon();
    });

program
    .command("stop")
    .description("停止 msgcode bot")
    .action(async () => {
        const { stopBot } = await import("./commands.js");
        await stopBot();
    });

program
    .command("restart [mode]")
    .description("硬重启 msgcode bot（默认后台，debug 前台输出）")
    .action(async (mode: string | undefined) => {
        const normalized = (mode ?? "").toLowerCase();
        if (normalized === "debug") {
            const { restartBot } = await import("./commands.js");
            await restartBot();
            return;
        }
        const { stopBot } = await import("./commands.js");
        await stopBot();
        await launchDaemon();
    });

program
    .command("allstop")
    .description("停止 msgcode bot + 所有 tmux 会话")
    .action(async () => {
        const { allStop } = await import("./commands.js");
        await allStop();
    });

program
    .command("stopall")
    .description("停止 msgcode bot + 所有 tmux 会话（别名）")
    .action(async () => {
        const { allStop } = await import("./commands.js");
        await allStop();
    });

program
    .command("init")
    .description("初始化配置目录和环境文件")
    .action(initBot);

program.parse();

async function launchDaemon(): Promise<void> {
    try {
        await mkdir(CONFIG_DIR, { recursive: true });
        await mkdir(LOG_DIR, { recursive: true });
    } catch {
        // ignore - already handled in init
    }

    console.log("🚀 正在后台启动 msgcode...");

    const env = {
        ...process.env,
        LOG_CONSOLE: "false",
    };

    const child = spawn("npx", ["tsx", DAEMON_SCRIPT], {
        detached: true,
        stdio: "ignore",
        env,
    });

    child.on("error", (error) => {
        console.error(`❌ 后台启动失败: ${error.message}`);
        process.exit(1);
    });

    child.unref();

    console.log(`✅ msgcode 已在后台启动 (PID: ${child.pid})`);
    console.log(`📂 日志输出: ${LOG_FILE}`);
}

/**
 * 初始化配置目录和环境文件
 */
async function initBot(): Promise<void> {
    const configDir = path.join(os.homedir(), ".config/msgcode");
    const logDir = path.join(configDir, "log");
    const envFile = path.join(configDir, ".env");
    const exampleFile = path.join(__dirname, "..", ".env.example");

    console.log("🔧 初始化 msgcode 配置...\n");

    // 0. 检测 Messages 数据库访问权限
    const chatDbPath = path.join(os.homedir(), "Library/Messages/chat.db");
    let hasDbAccess = false;
    try {
        accessSync(chatDbPath, constants.R_OK);
        console.log("✅ Messages 数据库权限: 已授权");
        hasDbAccess = true;
    } catch {
        console.log("⚠️  Messages 数据库权限: 未授权\n");
        console.log("   msgcode 需要读取 iMessage 数据库才能工作。");
        console.log("   正在打开系统隐私设置...\n");

        exec('open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"');

        console.log("   📋 请在弹出的窗口中:");
        console.log("      1. 点击左下角的 🔒 解锁");
        console.log("      2. 点击 + 添加你的终端应用");
        console.log("      3. 重启终端后重新运行 msgcode init\n");
        return;  // 权限未授权，停止后续流程
    }

    // 1. 创建配置目录
    try {
        await mkdir(configDir, { recursive: true });
        await mkdir(logDir, { recursive: true });
        console.log(`✅ 配置目录已就绪: ${configDir}`);
    } catch (error: any) {
        if (error.code !== "EEXIST") {
            console.error(`❌ 创建目录失败: ${error.message}`);
            process.exit(1);
        }
    }

    // 2. 复制环境文件模板（如果不存在）
    if (!existsSync(envFile)) {
        if (existsSync(exampleFile)) {
            await copyFile(exampleFile, envFile);
            console.log(`✅ 创建配置文件: ${envFile}`);
        } else {
            // 模板不存在时，创建最小配置文件
            const { writeFileSync } = await import("node:fs");
            const defaultEnv = `# msgcode 配置文件
# 白名单（至少配置一项）
MY_EMAIL=
MY_PHONE=

# 默认群组（init 命令会自动填写）
DEFAULT_GROUP=default

# 日志级别：debug | info | warn | error
LOG_LEVEL=info
`;
            writeFileSync(envFile, defaultEnv);
            console.log(`✅ 创建配置文件: ${envFile}`);
        }
    } else {
        console.log(`ℹ️  配置文件已存在: ${envFile}`);
    }

    // 3. 交互式配置
    console.log("\n" + "=".repeat(50));
    console.log("📝 开始交互式配置");
    console.log("=".repeat(50) + "\n");

    const readline = await import("node:readline");
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    const question = (prompt: string): Promise<string> =>
        new Promise((resolve) => rl.question(prompt, resolve));

    try {
        // 3.1 输入邮箱（用户自己的 iMessage 账户邮箱）
        console.log("📧 请输入你的 iMessage 账户邮箱");
        console.log("   (只有你发的消息 bot 才会响应，其他人会被忽略)\n");
        const email = (await question("   邮箱: ")).trim();
        if (email && !email.includes("@")) {
            console.log("⚠️  邮箱格式不正确，请稍后手动编辑配置文件");
        }

        // 3.2 获取群组列表（使用 AppleScript 获取真正的群组名称）
        console.log("\n🔍 正在获取你的 iMessage 群组...");

        let groups: Array<{ id: string; name: string }> = [];
        try {
            const { promisify } = await import("node:util");
            const { exec: execCb } = await import("node:child_process");
            const execAsync = promisify(execCb);

            // AppleScript 获取所有群组的 ID 和名称
            // 注意：先 activate 确保获取最新数据（Messages 可能有缓存延迟）
            const script = `
tell application "System Events"
    -- 确保 Messages 在前台，获取最新群组列表
    tell application "Messages" to activate
    delay 0.5
end tell
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

            const { stdout } = await execAsync(
                `osascript -e '${script.replace(/'/g, "'\\''")}'`,
                { timeout: 10000 }
            );

            const seen = new Set<string>();
            for (const line of stdout.trim().split("\n")) {
                const [id, name] = line.split(":::");
                // 只取群组（chatId 包含 GUID 格式或 any;+; 前缀），并去重
                if (id && !seen.has(id) && (id.includes(";+;") || /^[a-f0-9]{32}$/i.test(id))) {
                    seen.add(id);
                    groups.push({
                        id,
                        name: name || "未命名群组",
                    });
                }
            }
        } catch (e: any) {
            console.log(`⚠️  获取群组失败: ${e.message}`);
        }

        let selectedGroup = "";
        let selectedGroupName = "";
        const displayGroups = groups.slice(0, 10);  // 最多显示10个
        if (displayGroups.length > 0) {
            console.log(`\n   找到 ${groups.length} 个群组${groups.length > 10 ? "（显示前10个）" : ""}:\n`);
            displayGroups.forEach((g, i) => {
                // 显示名称 + 末尾4位GUID，便于区分同名群组
                const shortGuid = g.id.length > 4 ? g.id.slice(-4) : g.id;
                console.log(`   [${i + 1}] ${g.name} (${shortGuid})`);
            });

            const choice = (await question("\n📌 选择要配置的群组 (输入数字): ")).trim();
            if (choice) {
                const idx = parseInt(choice) - 1;
                if (idx >= 0 && idx < displayGroups.length) {
                    selectedGroup = displayGroups[idx].id;
                    selectedGroupName = displayGroups[idx].name;
                    console.log(`✅ 已选择: ${selectedGroupName}`);
                } else {
                    console.log("⚠️  无效选择，请重新选择");
                    process.exit(1);
                }
            } else {
                console.log("⚠️  群组必选，请重新运行并选择");
                process.exit(1);
            }
        } else {
            console.log("   未找到群组，请先在 iMessage 中创建群组对话");
            process.exit(1);
        }

        // 3.3 询问项目路径
        let projectPath = "";
        if (selectedGroup) {
            console.log("\n📁 请输入 Claude 的工作目录");
            console.log("   (拖拽文件夹到终端即可获取路径，直接回车使用当前目录)\n");
            projectPath = (await question("   路径: ")).trim();
            if (!projectPath) {
                projectPath = process.cwd();
                console.log(`   使用当前目录: ${projectPath}`);
            }
        }

        // 3.4 写入配置
        console.log("\n📝 写入配置文件...");
        const { readFileSync, writeFileSync } = await import("node:fs");
        let envContent = readFileSync(envFile, "utf-8");

        // 更新邮箱（非空且格式正确时才写入）
        if (email && email.includes("@")) {
            if (envContent.match(/^MY_EMAIL=/m)) {
                envContent = envContent.replace(/^MY_EMAIL=.*$/m, `MY_EMAIL=${email}`);
            } else {
                envContent = `MY_EMAIL=${email}\n` + envContent;
            }
        }

        // 添加群组（包含项目路径）
        if (selectedGroup) {
            const groupLine = `GROUP_DEFAULT=${selectedGroup}:${projectPath}`;
            // 使用正则 /^GROUP_DEFAULT=/m 精确匹配，避免误匹配 GROUP_DEFAULT_BACKUP 等
            if (/^GROUP_DEFAULT=/m.test(envContent)) {
                envContent = envContent.replace(/^GROUP_DEFAULT=.*$/m, groupLine);
            } else {
                envContent += `\n${groupLine}\n`;
            }
            // 确保 DEFAULT_GROUP 存在
            if (envContent.match(/^DEFAULT_GROUP=/m)) {
                envContent = envContent.replace(/^DEFAULT_GROUP=.*$/m, "DEFAULT_GROUP=default");
            } else {
                envContent += "DEFAULT_GROUP=default\n";
            }
        }

        writeFileSync(envFile, envContent);
        console.log("✅ 配置已保存");

        rl.close();
    } catch (e) {
        rl.close();
        throw e;
    }

    // 4. 完成提示
    console.log("\n" + "=".repeat(50));
    console.log("✅ 初始化完成！");
    console.log("=".repeat(50) + "\n");

    console.log("📋 运行以下命令启动 bot:\n");
    console.log("   msgcode start\n");

    console.log("💡 如需修改配置:");
    console.log(`   vim ${envFile}\n`);
}
