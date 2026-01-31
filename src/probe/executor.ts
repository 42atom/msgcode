/**
 * msgcode: 命令执行器
 *
 * 提供可注入的命令执行接口，用于测试和生产环境
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { CommandExecutor, ExecResult } from "./types.js";

const execAsync = promisify(exec);

/**
 * 真实命令执行器（生产环境使用）
 *
 * 使用 child_process.exec 执行命令
 */
export class RealCommandExecutor implements CommandExecutor {
    async exec(command: string): Promise<ExecResult> {
        try {
            const { stdout, stderr } = await execAsync(command, {
                timeout: 5000,
            });
            return {
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                exitCode: 0,
            };
        } catch (error: any) {
            return {
                stdout: error.stdout || "",
                stderr: error.stderr || error.message,
                exitCode: error.code || 1,
            };
        }
    }
}

/**
 * Mock 命令执行器（测试环境使用）
 *
 * 预设命令的返回结果，不真正执行
 */
export class MockCommandExecutor implements CommandExecutor {
    private readonly responses: Map<string, ExecResult>;

    constructor(responses: Record<string, ExecResult>) {
        this.responses = new Map(
            Object.entries(responses).map(([key, value]) => [key, value])
        );
    }

    async exec(command: string): Promise<ExecResult> {
        // 精确匹配
        if (this.responses.has(command)) {
            return this.responses.get(command)!;
        }

        // 前缀匹配（用于带参数的命令）
        for (const [key, value] of this.responses.entries()) {
            if (command.startsWith(key)) {
                return value;
            }
        }

        // 未预设的命令返回失败
        return {
            stdout: "",
            stderr: `Mock: command not found: ${command}`,
            exitCode: 1,
        };
    }
}
