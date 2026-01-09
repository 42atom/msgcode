/**
 * msgcode: JSONL 输出读取器
 *
 * 增量读取 Claude Code 的 JSONL 输出文件
 */

import { promises as fs } from "node:fs";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

/**
 * JSONL 条目
 */
export interface JSONLEntry {
    timestamp: number;
    role: string;
    type?: string;
    content?: string;
    [key: string]: any;
}

/**
 * 读取结果
 */
export interface ReadResult {
    entries: JSONLEntry[];
    bytesRead: number;
    newOffset: number;
}

/**
 * 读取位置记录
 */
interface ReadPosition {
    filePath: string;
    offset: number;
}

/**
 * Claude 输出读取器
 */
export class OutputReader {
    private positions = new Map<string, ReadPosition>();

    /**
     * 将项目目录转换为 Claude 项目目录名称
     * 例如: /Users/admin/BotRoot/00_projects → -Users-admin-BotRoot-00-projects
     * 规则: 所有非字母数字字符都替换为 "-"
     */
    private projectDirToClaudeDir(projectDir: string): string {
        // Claude 将路径中的所有非字母数字字符替换为 "-"
        return "-" + projectDir.replace(/[^a-zA-Z0-9]/g, "-").replace(/^-/, "").replace(/-+/g, "-");
    }

    /**
     * 查找最新的 JSONL 文件
     */
    async findLatestJsonl(projectDir?: string): Promise<string | null> {
        try {
            const homeDir = process.env.HOME || "~";
            const claudeProjectsBase = `${homeDir}/.claude/projects`;

            // 方法1: 如果有项目目录，查找对应的 Claude 项目目录
            if (projectDir) {
                const claudeDirName = this.projectDirToClaudeDir(projectDir);
                const claudeDir = `${claudeProjectsBase}/${claudeDirName}`;

                try {
                    const files = await fs.readdir(claudeDir, { recursive: true });
                    const jsonlFiles = (files as string[])
                        .filter(f => f.endsWith(".jsonl") && !f.includes("subagents"))
                        .map(f => `${claudeDir}/${f}`);

                    if (jsonlFiles.length > 0) {
                        // 按修改时间排序，取最新的
                        const stats = await Promise.all(
                            jsonlFiles.map(async f => ({
                                path: f,
                                mtime: (await fs.stat(f)).mtime.getTime(),
                            }))
                        );
                        stats.sort((a, b) => b.mtime - a.mtime);
                        return stats[0].path;
                    }
                } catch {
                    // 目录可能不存在，尝试模糊匹配
                }

                // 方法1.5: 模糊匹配项目目录名（尝试多个路径段）
                try {
                    const dirs = await fs.readdir(claudeProjectsBase);
                    const pathSegments = projectDir.split("/").filter(Boolean);

                    // 尝试匹配最后几个路径段
                    let matchingDir: string | undefined;
                    for (let i = pathSegments.length - 1; i >= 0 && !matchingDir; i--) {
                        const segment = pathSegments[i].replace(/[^a-zA-Z0-9]/g, "-");
                        matchingDir = dirs.find(d => d.includes(segment));
                    }


                    if (matchingDir) {
                        const matchedClaudeDir = `${claudeProjectsBase}/${matchingDir}`;
                        const files = await fs.readdir(matchedClaudeDir, { recursive: true });
                        const jsonlFiles = (files as string[])
                            .filter(f => f.endsWith(".jsonl") && !f.includes("subagents"))
                            .map(f => `${matchedClaudeDir}/${f}`);

                        if (jsonlFiles.length > 0) {
                            const stats = await Promise.all(
                                jsonlFiles.map(async f => ({
                                    path: f,
                                    mtime: (await fs.stat(f)).mtime.getTime(),
                                }))
                            );
                            stats.sort((a, b) => b.mtime - a.mtime);
                            return stats[0].path;
                        }
                    }
                } catch {
                    // 继续使用 find 命令
                }
            }

            // 方法2: 使用 find 查找最近修改的 JSONL（排除 subagents）
            const { stdout } = await execAsync(
                `find ~/.claude/projects -name "*.jsonl" -path "*${projectDir ? projectDir.split("/").pop() : ""}*" ! -path "*/subagents/*" -mmin -30 -type f 2>/dev/null | head -1`,
                { timeout: 10000 }  // 10秒超时，防止卡死
            );
            const path = stdout.trim();

            // 方法3: 如果没找到，查找所有最近的 JSONL
            if (!path) {
                const { stdout: fallback } = await execAsync(
                    `find ~/.claude/projects -name "*.jsonl" ! -path "*/subagents/*" -mmin -30 -type f 2>/dev/null | head -1`,
                    { timeout: 10000 }  // 10秒超时，防止卡死
                );
                return fallback.trim() || null;
            }

            return path || null;
        } catch {
            return null;
        }
    }

    /**
     * 增量读取 JSONL 文件
     */
    async read(filePath: string): Promise<ReadResult> {
        const position = this.positions.get(filePath);
        const startOffset = position?.offset || 0;

        try {
            // 读取文件
            const content = await fs.readFile(filePath, "utf-8");
            const bytes = content.length;

            // 如果文件变小了（被重写），从头开始读
            const actualStart = bytes < startOffset ? 0 : startOffset;

            // 解析新增的行
            const entries: JSONLEntry[] = [];
            const newContent = content.slice(actualStart);
            const lines = newContent.split("\n").filter(Boolean);

            for (const line of lines) {
                try {
                    const entry = JSON.parse(line) as JSONLEntry;
                    entries.push(entry);
                } catch {
                    // 跳过无效行
                }
            }

            // 更新位置
            this.positions.set(filePath, {
                filePath,
                offset: bytes,
            });

            return {
                entries,
                bytesRead: bytes - actualStart,
                newOffset: bytes,
            };
        } catch (error: any) {
            if (error.code === "ENOENT") {
                // 文件不存在，重置位置
                this.positions.delete(filePath);
                return { entries: [], bytesRead: 0, newOffset: 0 };
            }
            throw error;
        }
    }

    /**
     * 读取指定项目的最新输出
     */
    async readProject(projectDir?: string): Promise<ReadResult> {
        const filePath = await this.findLatestJsonl(projectDir);
        if (!filePath) {
            return { entries: [], bytesRead: 0, newOffset: 0 };
        }
        return this.read(filePath);
    }

    /**
     * 重置读取位置
     */
    reset(filePath?: string): void {
        if (filePath) {
            this.positions.delete(filePath);
        } else {
            this.positions.clear();
        }
    }

    /**
     * 设置读取位置（用于并发安全：每个请求设置自己的起点）
     */
    setPosition(filePath: string, offset: number): void {
        this.positions.set(filePath, { filePath, offset });
    }

    /**
     * 获取当前读取位置
     */
    getPosition(filePath: string): number {
        return this.positions.get(filePath)?.offset || 0;
    }
}
