/**
 * msgcode: tmux 会话管理
 *
 * 管理与 Coder CLI / Claude CLI 的 tmux 会话。
 *
 * 关键约束：
 * - Runtime runner：仅区分 "tmux" | "direct"
 * - tmux 内具体 CLI：通过 runnerOld 区分（"codex" | "claude-code" | "claude"(legacy)）
 * - 注意：不存在 "claude-code" 可执行文件；这里的 "claude-code" 表示 `claude --dangerously-skip-permissions`
 */

import { exec, spawn } from "node:child_process";
import { promisify } from "node:util";

import { logger } from "../logger/index.js";
import { CodexOutputReader, readCodexSessionMeta } from "../output/codex-reader.js";
import { upsertSession, updateSessionStopTime, getSession } from "./registry.js";

const execAsync = promisify(exec);
const READY_WAIT_TIMEOUT_MS = 15000; // /start 等待就绪的上限（Codex 首次启动可能较慢）
const STARTUP_SLOW_THRESHOLD_MS = 10000; // 超过该阈值视为启动异常

/**
 * 旧执行臂类型（存储层兼容）
 *
 * - 用于 SessionRecord.runner 字段存储（兼容历史数据）
 * - 逐步废弃，新代码应使用 RunnerType（运行时分类）+ runnerOld（具体 CLI）
 */
export type RunnerTypeOld = "claude" | "codex" | "claude-code";

/**
 * 运行时执行臂分类
 *
 * - tmux: 需要 tmux 会话管理（codex / claude CLI）
 * - direct: 直接调用 provider（mlx / lmstudio / llama / openai / ...）
 */
export type RunnerType = "tmux" | "direct";

/**
 * 归一化 runnerOld → runnerType（守卫：不信任外部传入）
 */
export function normalizeRunnerType(runner: RunnerTypeOld): RunnerType {
    // 本文件只管理 tmux 会话；历史 runnerOld 均归到 tmux。
    // direct providers 不会写入 tmux registry。
    void runner;
    return "tmux";
}

function normalizeRunnerOldFamily(runnerOld: RunnerTypeOld): "claude" | "codex" {
    return runnerOld === "codex" ? "codex" : "claude";
}

function getRunnerOldDisplayName(runnerOld: RunnerTypeOld): string {
    if (runnerOld === "codex") return "Codex";
    if (runnerOld === "claude-code") return "Claude Code";
    return "Claude";
}

/**
 * 校验路径是否安全（防止路径遍历和命令注入）
 *
 * 规则：
 * - 必须以 / 开头（绝对路径）
 * - 不允许包含 ..（路径遍历）
 * - 不允许包含 Shell 特殊字符（$, `, !）
 */
function isSafePath(path: string): boolean {
    // 只允许绝对路径；禁止路径遍历；禁止控制字符与换行（避免注入 tmux 输入流）
    return path.startsWith("/") && !path.includes("..") && !/[\r\n\0]/.test(path) && !/[$`!]/.test(path);
}

/**
 * 单引号转义（用于 Shell 命令中的路径）
 * 将 ' 转义为 '\''（结束单引号、转义单引号、重新开始单引号）
 */
function shellEscapeSingleQuote(str: string): string {
    return "'" + str.replace(/'/g, "'\\''") + "'";
}

function buildSafeCdCommand(dir: string): string {
    // 使用 cd -- '<escaped>' 兼容空格/特殊字符，避免被 shell 解释
    return `cd -- ${shellEscapeSingleQuote(dir)}`;
}

/**
 * 会话状态
 */
export enum SessionStatus {
    Stopped = "stopped",
    Starting = "starting",
    Ready = "ready",
}

/**
 * tmux 会话管理器
 */
export class TmuxSession {
    private static sessions = new Map<string, SessionState>();

    /**
     * 从 pane 输出中尽力推断当前 CLI（用于 /start 切换执行臂时的兼容）
     *
     * 注意：这里只做 best-effort，不追求 100% 准确。
     */
    private static detectRunnerFromPaneOutput(paneOutput: string): RunnerTypeOld | null {
        // Claude 的特征
        if (paneOutput.includes("How can I help?") || paneOutput.includes("bypass permissions") || paneOutput.includes("╭")) {
            return "claude";
        }

        // Codex 的特征：提示符或常见欢迎语
        const lines = paneOutput.split("\n");
        const lastLine = (lines[lines.length - 1] || "").trim();
        if (
            /^[>$/%]\s*$/.test(lastLine) ||
            lastLine.startsWith("›") ||
            lastLine.startsWith("❯") ||
            paneOutput.includes("? for shortcuts") ||
            paneOutput.includes("context left") ||
            paneOutput.includes("entered the chat") ||
            paneOutput.includes("No previous session")
        ) {
            return "codex";
        }

        return null;
    }

    /**
     * 会话状态（T1: 支持 Codex ready 检测）
     */
    private static async getStatus(sessionName: string, runnerOld: RunnerTypeOld = "claude"): Promise<SessionStatus> {
        try {
            const { stdout } = await execAsync(`tmux list-sessions -F "#{session_name}"`, { timeout: 5000 });
            if (!stdout.split("\n").includes(sessionName)) {
                // 会话不存在，同步清理缓存（防止外部 tmux kill-session 后缓存不同步）
                this.sessions.delete(sessionName);
                return SessionStatus.Stopped;
            }

            // 检查进程是否在运行（通过检测提示符）
            const { stdout: paneOutput } = await execAsync(
                `tmux capture-pane -t ${sessionName} -p -S -100`,
                { timeout: 5000 }
            );

            const family = normalizeRunnerOldFamily(runnerOld);
            if (family === "claude") {
                // Claude 就绪标志：出现 "How can I help?" 或 "╭"
                if (paneOutput.includes("How can I help?") || paneOutput.includes("╭")) {
                    return SessionStatus.Ready;
                }
            } else if (family === "codex") {
                // Codex 就绪标志：检查是否有命令提示符
                // Codex CLI 在 --no-alt-screen 模式下通常会显示 > 或 $ 提示符
                // 或者输出结束于新行后跟提示符
                const lines = paneOutput.split("\n");
                const tail = lines.slice(-20).map(l => l.trim()).filter(Boolean);
                const lastLine = tail[tail.length - 1] || "";

                // Codex inline mode 常见提示符：› / ❯ / > / $ / %
                const hasPrompt = tail.some(l => /^[›❯>$/%]/.test(l));
                if (hasPrompt) {
                    return SessionStatus.Ready;
                }

                // 也检查是否包含常见的 codex ready 标志
                if (paneOutput.includes("? for shortcuts") || paneOutput.includes("context left")) {
                    return SessionStatus.Ready;
                }
                if (paneOutput.includes("Ready") || paneOutput.includes("entered the chat")) {
                    return SessionStatus.Ready;
                }
            }

            return SessionStatus.Starting;
        } catch {
            // 出错时也清理缓存
            this.sessions.delete(sessionName);
            return SessionStatus.Stopped;
        }
    }

    /**
     * 生成会话名称（msgcode-前缀）
     */
    static getSessionName(groupName: string): string {
        const cleanName = groupName.toLowerCase().replace(/[^a-z0-9]/g, "_");
        return `msgcode-${cleanName}`;
    }

    /**
     * 启动 tmux 会话并运行 CLI（T1: 支持多执行臂）
     *
     * 会话已存在：恢复会话，更新工作目录
     * 会话不存在：创建新会话
     *
     * @param groupName 组名
     * @param projectDir 项目目录
     * @param runnerType 运行时执行臂分类（tmux/direct）
     * @param runnerOld tmux 内具体 CLI（codex/claude-code/claude）
     */
    static async start(
        groupName: string,
        projectDir: string | undefined,
        runnerType: RunnerType = "tmux",
        runnerOld?: RunnerTypeOld
    ): Promise<string> {
        if (runnerType !== "tmux") {
            throw new Error(`TmuxSession.start 仅支持 tmux 执行臂，当前: ${runnerType}`);
        }

        const sessionName = this.getSessionName(groupName);
        const desiredRunnerOld: RunnerTypeOld = runnerOld ?? "claude-code";
        const state: SessionState = { groupName, projectDir, status: SessionStatus.Starting, runnerType, runnerOld: desiredRunnerOld };
        this.sessions.set(sessionName, state);
        const startTime = Date.now();

        // 检查会话是否已存在（不依赖 runner）
        let sessionExists = false;
        try {
            await execAsync(`tmux has-session -t ${sessionName}`, { timeout: 2000 });
            sessionExists = true;
        } catch {
            sessionExists = false;
        }

        if (sessionExists) {
            // 尝试识别实际执行臂；如与期望不一致，则重启会话（用户已切换 /model）
            const paneOutput = await this.capturePane(sessionName, 120);
            const actualRunner = this.detectRunnerFromPaneOutput(paneOutput);
            if (
                actualRunner &&
                normalizeRunnerOldFamily(actualRunner) !== normalizeRunnerOldFamily(desiredRunnerOld)
            ) {
                logger.info("检测到执行臂切换，重启 tmux 会话", {
                    module: "tmux",
                    sessionName,
                    actualRunner,
                    desiredRunner: desiredRunnerOld,
                });
                try {
                    await execAsync(`tmux kill-session -t ${sessionName}`, { timeout: 5000 });
                } catch {
                    // best-effort
                }
                this.sessions.delete(sessionName);
                // 继续走下面的“创建新会话”逻辑
            } else {
                // resume 语义 - 会话已存在，恢复并更新工作目录
                if (projectDir) {
                    // P0 修复：校验路径安全性
                    if (!isSafePath(projectDir)) {
                        throw new Error(`Invalid project directory: ${projectDir}`);
                    }
                    // P0: 使用 sendTextLiteral + sendEnter 避免Enter被吞
                    await this.sendTextLiteral(sessionName, buildSafeCdCommand(projectDir));
                    await new Promise(r => setTimeout(r, 50)); // 延迟防止UI吞键
                    await this.sendEnter(sessionName);
                }
                const status = await this.getStatus(sessionName, actualRunner ?? desiredRunnerOld);
                const statusText = status === SessionStatus.Ready ? "已就绪" : "正在启动";
                const runnerName = getRunnerOldDisplayName(actualRunner ?? desiredRunnerOld);
                // 同步缓存（避免 /status 口径漂移）
                state.runnerOld = actualRunner ?? desiredRunnerOld;
                state.status = status;

                // Session Registry: 记录会话信息
                try {
                    await upsertSession({
                        sessionName,
                        groupName,
                        projectDir,
                        runner: actualRunner ?? desiredRunnerOld,
                    });
                } catch (error) {
                    logger.warn("Session registry 更新失败（不影响主流程）", {
                        module: "tmux",
                        sessionName,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }

                return `已恢复 tmux 会话 "${sessionName}"\n执行臂: ${runnerName}\n工作目录: ${projectDir || "~/"}\n状态: ${statusText}`;
            }
        }

        // 创建新会话
        try {
            // P0 修复：校验路径安全性
            if (projectDir && !isSafePath(projectDir)) {
                throw new Error(`Invalid project directory: ${projectDir}`);
            }
            const dirArg = projectDir ? `-c ${shellEscapeSingleQuote(projectDir)}` : "";
            // 注意：这里仍用 execAsync，需要 shell 转义；sendCommand 则无需
            await execAsync(`tmux new-session -d -s ${sessionName} ${dirArg}`, { timeout: 5000 });

            // T1: 根据 runnerOld 启动不同的命令
            if (normalizeRunnerOldFamily(desiredRunnerOld) === "claude") {
                // Claude / Claude Code: 启动 claude CLI（不注入模型参数）
                await this.sendTextLiteral(sessionName, "claude --dangerously-skip-permissions");
                await new Promise(r => setTimeout(r, 50)); // 延迟防止UI吞键
                await this.sendEnter(sessionName);

                // 等待 Claude 启动，然后发送 Enter 跳过可能的确认对话框
                await new Promise(r => setTimeout(r, 2000));
                await this.sendEnter(sessionName);

                // fail-fast：检测启动错误（典型：claude 未安装 / PATH 缺失 / 装错包）
                await new Promise(r => setTimeout(r, 600));
                const paneOutput = await this.capturePane(sessionName, 80);
                if (paneOutput.includes("command not found: claude")) {
                    throw new Error(
                        "claude CLI 未安装或不在 PATH。请确认已安装 Anthropic Claude CLI（命令为 claude）。"
                    );
                }
                if (paneOutput.toLowerCase().includes("wrong package")) {
                    throw new Error(
                        "claude CLI 安装异常（Wrong package）。请按提示重新安装正确的包（例如：npm install -g @anthropic-ai/claude-code），并确保 PATH 指向 claude。"
                    );
                }
            } else if (desiredRunnerOld === "codex") {
                // Codex: 优先按 workspace 精确恢复会话（避免 resume --last 误捡子目录会话导致“串味/变慢”）
                // - 如果能找到同 cwd 的最近 rollout 文件：读取 session_meta.id → codex resume <id>
                // - 否则：启动新会话 codex
                let resumeSessionId: string | null = null;
                if (projectDir) {
                    try {
                        const reader = new CodexOutputReader();
                        const latestJsonl = await reader.findLatestJsonlForWorkspace(projectDir);
                        if (latestJsonl) {
                            const meta = await readCodexSessionMeta(latestJsonl);
                            resumeSessionId = meta?.id ?? null;
                        }
                    } catch {
                        // best-effort：找不到历史就当作新会话
                        resumeSessionId = null;
                    }
                }

                const codexCmd = resumeSessionId
                    ? (projectDir
                        ? `codex resume ${resumeSessionId} --no-alt-screen -C ${shellEscapeSingleQuote(projectDir)} -s workspace-write -a never`
                        : `codex resume ${resumeSessionId} --no-alt-screen -s workspace-write -a never`)
                    : (projectDir
                        ? `codex --no-alt-screen -C ${shellEscapeSingleQuote(projectDir)} -s workspace-write -a never`
                        : `codex --no-alt-screen -s workspace-write -a never`);

                if (resumeSessionId) {
                    logger.info("Codex 按 workspace 恢复会话", { module: "tmux", sessionName, projectDir, resumeSessionId });
                } else {
                    logger.info("Codex 启动新会话（未找到可恢复历史）", { module: "tmux", sessionName, projectDir });
                }

                // P0: 使用 sendTextLiteral + sendEnter 避免启动时Enter被吞
                await this.sendTextLiteral(sessionName, codexCmd);
                await new Promise(r => setTimeout(r, 50)); // 延迟防止UI吞键
                await this.sendEnter(sessionName);

                // 等待一下看是否成功启动
                await new Promise(r => setTimeout(r, 3000));

                // 检查是否成功，如果可能没有历史则使用普通模式
                let paneOutput = await this.capturePane(sessionName, 120);

                // Codex 有时会弹出"Update available"交互提示，远程使用会卡住。
                // 这里 best-effort 自动选择"Skip until next version"，保证会话可继续。
                if (paneOutput.includes("Update available!") && paneOutput.includes("Skip")) {
                    logger.info("检测到 Codex 更新提示，自动跳过", { module: "tmux", sessionName });
                    // P0: 使用 sendTextLiteral + sendEnter 避免启动时Enter被吞
                    await this.sendTextLiteral(sessionName, "3"); // Skip until next version
                    await new Promise(r => setTimeout(r, 50)); // 延迟防止UI吞键
                    await this.sendEnter(sessionName);
                    await new Promise(r => setTimeout(r, 800));
                    // 某些版本需要再按一次 Enter 才进入会话
                    await this.sendEnter(sessionName);
                    await new Promise(r => setTimeout(r, 800));
                    paneOutput = await this.capturePane(sessionName, 120);
                }

                if (resumeSessionId && (paneOutput.includes("No previous session") || paneOutput.includes("not found"))) {
                    // 指定 sessionId 恢复失败，fallback 到普通模式
                    logger.warn("Codex 恢复失败，fallback 到新会话", { module: "tmux", sessionName, projectDir, resumeSessionId });
                    const fallbackCmd = projectDir
                        ? `codex --no-alt-screen -C ${shellEscapeSingleQuote(projectDir)} -s workspace-write -a never`
                        : `codex --no-alt-screen -s workspace-write -a never`;
                    // P0: 使用 sendTextLiteral + sendEnter 避免启动时Enter被吞
                    await this.sendTextLiteral(sessionName, fallbackCmd);
                    await new Promise(r => setTimeout(r, 50)); // 延迟防止UI吞键
                    await this.sendEnter(sessionName);
                }
            }

            // 等待就绪
            const ready = await this.waitForReady(sessionName, desiredRunnerOld, READY_WAIT_TIMEOUT_MS);
            state.status = ready ? SessionStatus.Ready : SessionStatus.Starting;

            const dirInfo = projectDir ? `\n工作目录: ${projectDir}` : "";
            const runnerName = getRunnerOldDisplayName(desiredRunnerOld);
            const elapsed = Date.now() - startTime;
            if (!ready && elapsed > STARTUP_SLOW_THRESHOLD_MS) {
                logger.warn(`${runnerName} 启动异常: ${elapsed}ms 未就绪`, {
                    module: "tmux",
                    sessionName,
                    elapsed,
                    runnerOld: desiredRunnerOld,
                });
            }
            const readyInfo = ready
                ? `\n${runnerName} 已就绪`
                : elapsed > STARTUP_SLOW_THRESHOLD_MS
                    ? `\n${runnerName} 启动异常（超过10秒未就绪）`
                    : `\n${runnerName} 正在启动...`;

            // Session Registry: 记录新会话信息
            try {
                await upsertSession({
                    sessionName,
                    groupName,
                    projectDir,
                    runner: desiredRunnerOld,
                });
            } catch (error) {
                logger.warn("Session registry 更新失败（不影响主流程）", {
                    module: "tmux",
                    sessionName,
                    error: error instanceof Error ? error.message : String(error),
                });
            }

            return `已启动 tmux 会话 "${sessionName}"\n执行臂: ${runnerName}${dirInfo}${readyInfo}`;
        } catch (error: any) {
            this.sessions.delete(sessionName);
            throw new Error(`启动失败: ${error.message}`);
        }
    }

    /**
     * 停止 tmux 会话
     */
    static async stop(groupName: string): Promise<string> {
        const sessionName = this.getSessionName(groupName);

        try {
            await execAsync(`tmux kill-session -t ${sessionName}`, { timeout: 5000 });
            this.sessions.delete(sessionName);

            // Session Registry: 更新停止时间
            try {
                await updateSessionStopTime(sessionName);
            } catch (error) {
                logger.warn("Session registry 更新失败（不影响主流程）", {
                    module: "tmux",
                    sessionName,
                    error: error instanceof Error ? error.message : String(error),
                });
            }

            return `已关闭 tmux 会话 "${sessionName}"`;
        } catch (error: any) {
            if (error.message.includes("session not found")) {
                return `tmux 会话 "${sessionName}" 未运行`;
            }
            throw error;
        }
    }

    /**
     * 获取会话状态（T1: 支持多执行臂 + Session Registry）
     *
     * - runner: 优先来自 registry（真相源）
     * - running: 来自 tmux 实况
     */
    static async status(groupName: string): Promise<string> {
        const sessionName = this.getSessionName(groupName);

        // 1. 从 registry 读取会话记录（真相源）
        let registryRecord: Awaited<ReturnType<typeof getSession>> | null = null;
        try {
            registryRecord = await getSession(sessionName);
        } catch {
            // registry 读取失败，继续使用 tmux 实况
        }

        // 2. 检查 tmux 实际状态
        let tmuxExists = false;
        try {
            await execAsync(`tmux has-session -t ${sessionName}`, { timeout: 2000 });
            tmuxExists = true;
        } catch {
            tmuxExists = false;
        }

        // 3. 处理冲突情况
        if (tmuxExists && !registryRecord) {
            // tmux 存在但 registry 无记录：提示用户重新登记
            const paneOutput = await this.capturePane(sessionName, 120);
            const runner = this.detectRunnerFromPaneOutput(paneOutput);
            const runnerName = runner ? getRunnerOldDisplayName(runner) : "Claude";
            return `tmux 会话 "${sessionName}" 正在运行（未登记）\n执行臂: ${runnerName}\n\n提示：请发送 /start 重新登记`;
        }

        if (!tmuxExists) {
            // tmux 不存在
            if (registryRecord) {
                // registry 有记录但 tmux 不存在：显示 stopped 并保留历史信息
                const runnerName = getRunnerOldDisplayName(registryRecord.runner);
                const dirInfo = registryRecord.projectDir ? `\n工作目录: ${registryRecord.projectDir}` : "";
                return `tmux 会话 "${sessionName}" 未运行\n上次执行臂: ${runnerName}${dirInfo}`;
            }
            return `tmux 会话 "${sessionName}" 未运行`;
        }

        // 4. 正常情况：tmux 存在且 registry 有记录
        const runnerOld: RunnerTypeOld = registryRecord?.runner || "claude";
        const status = await this.getStatus(sessionName, runnerOld);

        if (status === SessionStatus.Stopped) {
            return `tmux 会话 "${sessionName}" 未运行`;
        }

        const dirInfo = registryRecord?.projectDir ? `\n工作目录: ${registryRecord.projectDir}` : "";
        const runnerName = getRunnerOldDisplayName(runnerOld);
        const statusText = status === SessionStatus.Ready ? `${runnerName} 已就绪` : "正在启动";
        return `tmux 会话 "${sessionName}" 正在运行\n执行臂: ${runnerName}${dirInfo}\n状态: ${statusText}`;
    }

    /**
     * 获取会话状态（用于 responder 在发送前做 fail-fast）
     */
    static async getRunnerStatus(groupName: string, runnerType: RunnerType, runnerOld?: RunnerTypeOld): Promise<SessionStatus> {
        const sessionName = this.getSessionName(groupName);
        if (runnerType !== "tmux") {
            return SessionStatus.Stopped;
        }

        // 优先从 registry 读取 runnerOld（真相源）；fallback 到探测；再 fallback 到入参/默认值
        let registryRecord: Awaited<ReturnType<typeof getSession>> | null = null;
        try {
            registryRecord = await getSession(sessionName);
        } catch {
            registryRecord = null;
        }
        const inferredRunnerOld: RunnerTypeOld =
            registryRecord?.runner ??
            this.detectRunnerFromPaneOutput(await this.capturePane(sessionName, 120)) ??
            runnerOld ??
            "claude-code";

        return this.getStatus(sessionName, inferredRunnerOld);
    }

    /**
     * 在会话中执行命令
     *
     * P0 安全修复：使用 spawn 传递参数，避免 shell 命令注入
     * tmux send-keys 直接接收字符串参数，无需 shell 解析
     *
     * 注意：此方法为向后兼容保留，新代码应使用 sendTextLiteral + sendEnter
     */
    static async sendCommand(sessionName: string, command: string): Promise<void> {
        return new Promise((resolve, reject) => {
            let settled = false;
            const proc = spawn("tmux", ["send-keys", "-t", sessionName, command, "Enter"]);

            // 5秒超时计时器
            const timeoutId = setTimeout(() => {
                if (!settled && !proc.killed) {
                    proc.kill();
                    settled = true;
                    reject(new Error("tmux send-keys timeout"));
                }
            }, 5000);

            proc.on("close", (code: number | null) => {
                clearTimeout(timeoutId);
                if (settled) return;  // 已被超时处理
                settled = true;
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`tmux send-keys exited with code ${code}`));
                }
            });

            proc.on("error", (err: Error) => {
                clearTimeout(timeoutId);
                if (settled) return;
                settled = true;
                reject(err);
            });
        });
    }

    /**
     * 发送字面量文本到 tmux 会话（P0: 使用 -l 标志避免特殊字符被解释）
     *
     * 使用 tmux send-keys -l 发送字面量文本，不会解释特殊字符
     */
    static async sendTextLiteral(sessionName: string, text: string): Promise<void> {
        return new Promise((resolve, reject) => {
            let settled = false;
            // 使用 -l 标志发送字面量文本，避免特殊字符被 tmux 解释
            const proc = spawn("tmux", ["send-keys", "-t", sessionName, "-l", text]);

            const timeoutId = setTimeout(() => {
                if (!settled && !proc.killed) {
                    proc.kill();
                    settled = true;
                    reject(new Error("tmux send-keys -l timeout"));
                }
            }, 5000);

            proc.on("close", (code: number | null) => {
                clearTimeout(timeoutId);
                if (settled) return;
                settled = true;
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`tmux send-keys -l exited with code ${code}`));
                }
            });

            proc.on("error", (err: Error) => {
                clearTimeout(timeoutId);
                if (settled) return;
                settled = true;
                reject(err);
            });
        });
    }

    /**
     * 发送 Enter 键到 tmux 会话（P0: 分离发送，确保 Enter 不被吞）
     *
     * 使用 C-m（carriage return）发送 Enter，比 "Enter" 字面量更可靠
     */
    static async sendEnter(sessionName: string): Promise<void> {
        return new Promise((resolve, reject) => {
            let settled = false;
            // 使用 C-m（ carriage return）代替 "Enter" 字面量，更可靠
            const proc = spawn("tmux", ["send-keys", "-t", sessionName, "C-m"]);

            const timeoutId = setTimeout(() => {
                if (!settled && !proc.killed) {
                    proc.kill();
                    settled = true;
                    reject(new Error("tmux send-keys C-m timeout"));
                }
            }, 5000);

            proc.on("close", (code: number | null) => {
                clearTimeout(timeoutId);
                if (settled) return;
                settled = true;
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`tmux send-keys C-m exited with code ${code}`));
                }
            });

            proc.on("error", (err: Error) => {
                clearTimeout(timeoutId);
                if (settled) return;
                settled = true;
                reject(err);
            });
        });
    }

    /**
     * 发送文本 + Enter（P0: 两步发送，中间有延迟防吞键）
     *
     * @param delayMs 发送文本和 Enter 之间的延迟（毫秒），默认 50ms
     */
    static async sendTextWithEnter(sessionName: string, text: string, delayMs: number = 50): Promise<void> {
        await this.sendTextLiteral(sessionName, text);
        // 延迟 30-80ms 防止 UI 吞键
        await new Promise(resolve => setTimeout(resolve, delayMs));
        await this.sendEnter(sessionName);
    }

    /**
     * 检查输入栏是否仍包含指定文本（提交校验兜底）
     *
     * 用于检测 Enter 是否被吞，如果文本仍在输入栏则返回 true
     */
    static async isTextStillInInput(sessionName: string, text: string): Promise<boolean> {
        const paneOutput = await this.capturePane(sessionName, 50);
        const lines = paneOutput.split("\n");
        const lastLine = lines[lines.length - 1] || "";

        // Codex 提示符通常是 › 或 ❯
        // 如果最后一行是 "› <text>" 或类似模式，说明文本还在输入栏
        const promptPatterns = [/^[›\>\$]\s*/, /^❯\s*/];
        const trimmedLastLine = lastLine.trim();
        const trimmedText = text.trim();

        for (const pattern of promptPatterns) {
            if (pattern.test(trimmedLastLine)) {
                const afterPrompt = trimmedLastLine.replace(pattern, "").trim();
                if (afterPrompt === trimmedText || afterPrompt.includes(trimmedText)) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * 发送 ESC 键
     */
    static async sendEscape(sessionName: string): Promise<void> {
        await execAsync(`tmux send-keys -t ${sessionName} Escape`, { timeout: 5000 });
    }

    /**
     * 获取终端快照
     */
    static async capturePane(sessionName: string, lines: number = 100): Promise<string> {
        try {
            const { stdout } = await execAsync(
                `tmux capture-pane -t ${sessionName} -p -S -${lines}`,
                { timeout: 5000 }
            );
            return stdout.trim();
        } catch {
            return "";
        }
    }

    /**
     * 等待 tmux CLI 就绪（T1: 支持多执行臂）
     */
    private static async waitForReady(sessionName: string, runnerOld: RunnerTypeOld, timeout: number): Promise<boolean> {
        const start = Date.now();
        const checkInterval = 1000; // 每秒检查一次

        while (Date.now() - start < timeout) {
            const status = await this.getStatus(sessionName, runnerOld);
            if (status === SessionStatus.Ready) {
                return true;
            }
            await new Promise(resolve => setTimeout(resolve, checkInterval));
        }

        return false;
    }

    /**
     * 检查会话是否存在（T1: 支持多执行臂）
     */
    static async exists(groupName: string): Promise<boolean> {
        const sessionName = this.getSessionName(groupName);
        const state = this.sessions.get(sessionName);
        const runnerOld = state?.runnerOld || "claude";
        const status = await this.getStatus(sessionName, runnerOld);
        return status !== SessionStatus.Stopped;
    }
}

/**
 * 会话状态
 */
interface SessionState {
    groupName: string;
    projectDir?: string;
    status: SessionStatus;
    runnerType: RunnerType;
    runnerOld: RunnerTypeOld;
}
