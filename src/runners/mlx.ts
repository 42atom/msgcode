/**
 * msgcode: MLX Server Runner
 *
 * Manages MLX LM Server lifecycle (start/stop/status)
 * Similar to TmuxSession for codex runner
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

// ============================================
// Types
// ============================================

export interface MlxServerStatus {
    running: boolean;
    pid?: number;
    port?: number;
    model?: string;
}

export interface MlxStartOptions {
    modelPath: string;
    host: string;
    port: number;
    maxTokens: number;
}

// ============================================
// Constants
// ============================================

const PID_FILE = join(homedir(), ".config/msgcode/mlx-server.pid");
const LOG_FILE = join(homedir(), ".config/msgcode/log/mlx-server.log");

// ============================================
// MLX Server Manager
// ============================================

export class MlxServer {
    private static process: ReturnType<typeof spawn> | null = null;

    /**
     * Get MLX server status
     */
    static async getStatus(): Promise<MlxServerStatus> {
        // Check if we have a tracked process
        if (this.process && !this.process.killed) {
            return {
                running: true,
                pid: this.process.pid,
            };
        }

        // Check PID file
        try {
            const { readFile } = await import("node:fs/promises");
            const pidStr = await readFile(PID_FILE, "utf-8");
            const pid = parseInt(pidStr.trim(), 10);

            if (pid && !isNaN(pid)) {
                // Check if process is actually running
                try {
                    process.kill(pid, 0); // Signal 0 checks if process exists
                    return { running: true, pid };
                } catch {
                    // Process not running, clean up PID file
                    const { unlink } = await import("node:fs/promises");
                    await unlink(PID_FILE).catch(() => {});
                }
            }
        } catch {
            // PID file doesn't exist or can't be read
        }

        return { running: false };
    }

    /**
     * Start MLX server
     */
    static async start(options: MlxStartOptions): Promise<string> {
        const { modelPath, host, port, maxTokens } = options;

        // Validate model path
        if (!existsSync(modelPath)) {
            throw new Error(`MLX 模型路径不存在: ${modelPath}`);
        }

        // Check if already running (PID file or port check)
        const status = await this.getStatus();
        if (status.running) {
            return `MLX server 已在运行（PID: ${status.pid}）`;
        }

        // P0: Port-based single instance check (catch manually started servers)
        try {
            const { exec } = await import("node:child_process");
            const { promisify } = await import("node:util");
            const execAsync = promisify(exec);
            const { stdout } = await execAsync(`lsof -ti:${port} 2>/dev/null || true`);
            const existingPid = stdout.trim();
            if (existingPid) {
                // Found process on port, update PID file
                const { writeFile } = await import("node:fs/promises");
                await writeFile(PID_FILE, existingPid);
                return `MLX server 已在运行（端口 ${port} 被占用，PID: ${existingPid}）`;
            }
        } catch {
            // lsof check failed, continue with startup
        }

        // Ensure log directory exists
        const logDir = dirname(LOG_FILE);
        const { mkdir } = await import("node:fs/promises");
        await mkdir(logDir, { recursive: true });

        // Determine python command
        // Default to venv Python where MLX is installed
        const defaultPython = join(homedir(), "Models", "venv", "bin", "python");
        const pythonCmd = process.env.MLX_PYTHON || defaultPython;

        // Start MLX server
        const args = [
            "-m", "mlx_lm.server",
            "--model", modelPath,
            "--host", host,
            "--port", String(port),
            "--max-tokens", String(maxTokens),
        ];

        const logStream = await import("node:fs/promises").then(m =>
            m.open(LOG_FILE, "a")
        );

        this.process = spawn(pythonCmd, args, {
            stdio: ["ignore", "pipe", "pipe"],
            detached: false,
        });

        // Pipe output to log file
        this.process.stdout?.on("data", (data) => {
            logStream.write(data);
        });
        this.process.stderr?.on("data", (data) => {
            logStream.write(data);
        });

        // Save PID
        const { writeFile } = await import("node:fs/promises");
        await writeFile(PID_FILE, String(this.process.pid));

        // Wait a bit and check if server started successfully
        await new Promise(resolve => setTimeout(resolve, 2000));

        if (this.process.killed) {
            throw new Error("MLX server 启动失败（进程已退出）");
        }

        return `MLX server 已启动（PID: ${this.process.pid}, 端口: ${port}）`;
    }

    /**
     * Stop MLX server
     */
    static async stop(): Promise<string> {
        const status = await this.getStatus();

        if (!status.running) {
            return "MLX server 未运行";
        }

        if (!status.pid) {
            return "MLX server 未运行（无 PID）";
        }

        try {
            // Try graceful shutdown first
            process.kill(status.pid, "SIGTERM");

            // Wait a bit
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Check if still running, force kill if needed
            try {
                process.kill(status.pid, 0);
                process.kill(status.pid, "SIGKILL");
            } catch {
                // Process already terminated
            }

            // Clean up PID file
            const { unlink } = await import("node:fs/promises");
            await unlink(PID_FILE).catch(() => {});

            return "MLX server 已停止";
        } catch (error) {
            throw new Error(`停止 MLX server 失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Start MLX server with workspace config
     */
    static async startFromWorkspace(workspacePath: string): Promise<string> {
        // Load MLX config from workspace
        const { loadWorkspaceConfig, getMlxConfig } = await import("../config/workspace.js");
        const config = await loadWorkspaceConfig(workspacePath);
        const mlx = await getMlxConfig(workspacePath);

        // Get model path from env or config
        const modelPath = process.env.MLX_MODEL_PATH || mlx.modelId || config["mlx.modelId"];

        if (!modelPath) {
            throw new Error("MLX 模型路径未配置\n\n请设置环境变量 MLX_MODEL_PATH 或在 config.json 中配置 mlx.modelId");
        }

        return this.start({
            modelPath,
            host: mlx.baseUrl.replace(/^https?:\/\/[^\/]+/, "").replace(/:\d+$/, "") || "127.0.0.1",
            port: parseInt(mlx.baseUrl.split(":").pop() || "18000", 10),
            maxTokens: mlx.maxTokens,
        });
    }
}
