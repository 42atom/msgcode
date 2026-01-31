/**
 * msgcode: 探针实现
 *
 * 实现各种系统健康检查探针
 */

import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { CommandExecutor, ProbeConfig, ProbeResult, ProbeReport, ProbeSummary } from "./types.js";

/**
 * 展开路径中的 ~
 */
function expandPath(p: string): string {
    if (p.startsWith("~/")) {
        return join(homedir(), p.slice(2));
    }
    return p;
}

/**
 * 检查 imsg 二进制可执行性和版本
 */
async function checkImsgBinary(config: ProbeConfig, executor: CommandExecutor): Promise<ProbeResult> {
    const imsgPath = config.imsgPath ? expandPath(config.imsgPath) : "imsg";

    // 首先尝试运行版本命令（这对 mock executor 更友好）
    const versionResult = await executor.exec(imsgPath + " --version");
    
    if (versionResult.exitCode === 0 && versionResult.stdout) {
        return {
            name: "imsg version",
            ok: true,
            details: versionResult.stdout,
        };
    }

    // 命令失败，检查文件系统
    try {
        accessSync(imsgPath, constants.X_OK);
        // 文件存在但版本命令失败
        return {
            name: "imsg version",
            ok: false,
            details: imsgPath + " exists but --version failed",
            fixHint: "Verify imsg binary: ./scripts/verify-imsg.sh",
        };
    } catch {
        // 文件不存在
        return {
            name: "imsg executable",
            ok: false,
            details: imsgPath + " not found or not executable",
            fixHint: "Install imsg: ./scripts/build-imsg.sh or set IMSG_PATH in ~/.config/msgcode/.env",
        };
    }
}

/**
 * 检查 imsg rpc 命令可用性
 */
async function checkImsgRpc(config: ProbeConfig, executor: CommandExecutor): Promise<ProbeResult> {
    const imsgPath = config.imsgPath ? expandPath(config.imsgPath) : "imsg";

    const helpResult = await executor.exec(imsgPath + " rpc --help");
    if (helpResult.exitCode !== 0) {
        return {
            name: "rpc help available",
            ok: false,
            details: "imsg rpc --help failed",
            fixHint: "Update imsg to v0.4.0+ with rpc support",
        };
    }

    // 检查关键子命令是否存在
    const output = helpResult.stdout + helpResult.stderr;
    const hasWatch = output.includes("watch");
    const hasSend = output.includes("send");
    const hasChats = output.includes("chats");

    const missing: string[] = [];
    if (!hasWatch) missing.push("watch");
    if (!hasSend) missing.push("send");
    if (!hasChats) missing.push("chats");

    if (missing.length > 0) {
        return {
            name: "rpc help available",
            ok: false,
            details: "imsg rpc missing subcommands: " + missing.join(", "),
            fixHint: "Update imsg to v0.4.0+ with full rpc support",
        };
    }

    return {
        name: "rpc help available",
        ok: true,
        details: "watch, send, chats available",
    };
}

/**
 * 检查 routes.json 可读性
 */
function checkRoutesReadable(config: ProbeConfig): ProbeResult {
    const routesPath = expandPath(config.routesPath);

    if (!existsSync(routesPath)) {
        return {
            name: "routes.json readable",
            ok: false,
            details: routesPath + " not found",
            fixHint: "Routes will be created on first use (E12 feature)",
        };
    }

    try {
        accessSync(routesPath, constants.R_OK);
        return {
            name: "routes.json readable",
            ok: true,
            details: routesPath,
        };
    } catch {
        return {
            name: "routes.json readable",
            ok: false,
            details: routesPath + " exists but not readable",
            fixHint: "Check file permissions: chmod 644 ~/.config/msgcode/routes.json",
        };
    }
}

/**
 * 检查 routes.json 可解析性
 */
function checkRoutesValid(config: ProbeConfig): ProbeResult {
    const routesPath = expandPath(config.routesPath);

    if (!existsSync(routesPath)) {
        return {
            name: "routes.json valid JSON",
            ok: true, // 不存在时不算失败，属于 SKIP
            details: "file not found (will be created)",
        };
    }

    try {
        const content = readFileSync(routesPath, "utf-8");
        JSON.parse(content);
        return {
            name: "routes.json valid JSON",
            ok: true,
            details: "valid JSON format",
        };
    } catch (error: any) {
        return {
            name: "routes.json valid JSON",
            ok: false,
            details: error.message,
            fixHint: "Fix JSON syntax or delete file to regenerate",
        };
    }
}

/**
 * 检查 WORKSPACE_ROOT 可写性
 */
async function checkWorkspaceWritable(config: ProbeConfig): Promise<ProbeResult> {
    const workspaceRoot = expandPath(config.workspaceRoot);

    // 检查目录是否存在
    if (!existsSync(workspaceRoot)) {
        // 尝试创建
        try {
            await mkdir(workspaceRoot, { recursive: true });
            return {
                name: "WORKSPACE_ROOT writable",
                ok: true,
                details: workspaceRoot + " (created)",
            };
        } catch (error: any) {
            return {
                name: "WORKSPACE_ROOT writable",
                ok: false,
                details: "cannot create " + workspaceRoot + ": " + error.message,
                fixHint: "Create directory: mkdir -p ~/msgcode-workspaces",
            };
        }
    }

    // 检查可写性
    const testFile = join(workspaceRoot, ".msgcode-write-test");
    try {
        await writeFile(testFile, "test");
        await unlink(testFile);
        return {
            name: "WORKSPACE_ROOT writable",
            ok: true,
            details: workspaceRoot,
        };
    } catch (error: any) {
        return {
            name: "WORKSPACE_ROOT writable",
            ok: false,
            details: workspaceRoot + " not writable: " + error.message,
            fixHint: "Fix permissions: chmod 755 ~/msgcode-workspaces",
        };
    }
}

/**
 * 检查 tmux 可用性
 */
async function checkTmuxAvailable(executor: CommandExecutor): Promise<ProbeResult> {
    const result = await executor.exec("tmux -V");

    if (result.exitCode !== 0 || !result.stdout) {
        return {
            name: "tmux available",
            ok: false,
            details: "tmux not found",
            fixHint: "Install tmux: brew install tmux",
        };
    }

    return {
        name: "tmux available",
        ok: true,
        details: result.stdout,
    };
}

/**
 * 检查 claude 可用性
 */
async function checkClaudeAvailable(executor: CommandExecutor): Promise<ProbeResult> {
    const result = await executor.exec("claude --version");

    if (result.exitCode !== 0 || !result.stdout) {
        return {
            name: "claude available",
            ok: false,
            details: "claude CLI not found",
            fixHint: "Install Claude CLI: npm install -g @anthropic-ai/claude-cli",
        };
    }

    return {
        name: "claude available",
        ok: true,
        details: result.stdout,
    };
}

/**
 * 运行所有探针
 */
export async function runProbes(config: ProbeConfig, executor: CommandExecutor): Promise<ProbeReport> {
    const results: ProbeResult[] = [];

    // 1. imsg 可执行性和版本
    const imsgBinary = await checkImsgBinary(config, executor);
    results.push(imsgBinary);

    // 2. imsg rpc 可用性
    const imsgRpc = await checkImsgRpc(config, executor);
    results.push(imsgRpc);

    // 3. routes.json 可读性
    const routesReadable = checkRoutesReadable(config);
    results.push(routesReadable);

    // 4. routes.json 可解析性
    const routesValid = checkRoutesValid(config);
    results.push(routesValid);

    // 5. WORKSPACE_ROOT 可写性
    const workspaceWritable = await checkWorkspaceWritable(config);
    results.push(workspaceWritable);

    // 6. tmux 可用性
    const tmuxAvailable = await checkTmuxAvailable(executor);
    results.push(tmuxAvailable);

    // 7. claude 可用性
    const claudeAvailable = await checkClaudeAvailable(executor);
    results.push(claudeAvailable);

    // 计算汇总
    const summary: ProbeSummary = {
        ok: results.filter(r => r.ok).length,
        fail: results.filter(r => !r.ok).length,
        skip: 0,
    };

    return {
        results,
        summary,
        allOk: summary.fail === 0,
    };
}
