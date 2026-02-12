/**
 * msgcode: JSONL 输出读取器
 *
 * 增量读取 Claude Code 的 JSONL 输出文件
 *
 * P0: offset 统一使用字节（byte），与 fs.stat().size 保持一致
 * 使用 createReadStream({ start }) 从字节偏移开始读取，避免中文 UTF-8 编码问题
 */

import { createReadStream, promises as fs } from "node:fs";

/**
 * 从字节偏移读取 UTF-8 内容
 *
 * @param filePath 文件路径
 * @param start 字节偏移（与 fs.stat().size 一致）
 * @returns 从 start 开始的内容
 */
async function readUtf8FromOffset(filePath: string, start: number): Promise<string> {
    const stream = createReadStream(filePath, { encoding: "utf8", start });
    return await new Promise<string>((resolve, reject) => {
        let data = "";
        stream.on("data", (chunk: string | Buffer) => {
            data += typeof chunk === "string" ? chunk : chunk.toString("utf8");
        });
        stream.on("end", () => resolve(data));
        stream.on("error", reject);
    });
}

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
    /** P0 Batch-1: 选路评分信息（用于日志） */
    selectionInfo?: {
        path: string;
        isDeliverable: boolean;
        score: number;
        candidatesCount: number;
    };
}

/**
 * 候选文件
 */
interface CandidateFile {
    path: string;
    mtime: number;
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
     * 例如: /Users/<you>/BotRoot/00_projects → -Users-you-BotRoot-00-projects
     * 规则: 所有非字母数字字符都替换为 "-"
     */
    private projectDirToClaudeDir(projectDir: string): string {
        // Claude 将路径中的所有非字母数字字符替换为 "-"
        return "-" + projectDir.replace(/[^a-zA-Z0-9]/g, "-").replace(/^-/, "").replace(/-+/g, "-");
    }

    /**
     * 查找最新的 JSONL 文件
     *
     * P0 Batch-1: workspace 定位优先 + deliverable 打分
     * - 只在 projectDir 归一化目录内查找（不全局 find）
     * - 优先 deliverable 文件（前 30 行有 assistant 相关内容）
     * - 兼容 agent-*.jsonl（关联 sessionId.jsonl）
     */
    async findLatestJsonl(projectDir?: string): Promise<string | null> {
        const result = await this.findLatestJsonlWithInfo(projectDir);
        return result?.path || null;
    }

    /**
     * P0 Batch-1: 查找 JSONL 并返回完整选路信息
     */
    private async findLatestJsonlWithInfo(projectDir?: string): Promise<{ path: string; selectionInfo: ReadResult["selectionInfo"] } | null> {
        if (!projectDir) {
            return null;  // 必须有 projectDir 才能精确定位
        }

        try {
            const homeDir = process.env.HOME || "~";
            const claudeProjectsBase = `${homeDir}/.claude/projects`;
            const claudeDirName = this.projectDirToClaudeDir(projectDir);
            const claudeDir = `${claudeProjectsBase}/${claudeDirName}`;

            // 检查目录是否存在
            await fs.access(claudeDir);

            // 收集候选文件（排除 subagents）
            const candidates = await this.collectCandidates(claudeDir);
            if (candidates.length === 0) {
                return null;
            }

            // 打分并排序（deliverable 优先，再按 mtime）
            const scored = await this.scoreCandidates(candidates);
            if (scored.length === 0) {
                return null;
            }

            const selected = scored[0];
            return {
                path: selected.path,
                selectionInfo: {
                    path: selected.path,
                    isDeliverable: selected.isDeliverable,
                    score: selected.score,
                    candidatesCount: candidates.length,
                },
            };
        } catch {
            return null;
        }
    }

    /**
     * P0 Batch-1: 收集候选 JSONL 文件
     * - 排除 subagents/ 目录
     * - 兼容 agent-*.jsonl（关联 sessionId.jsonl）
     */
    private async collectCandidates(claudeDir: string): Promise<CandidateFile[]> {
        const candidates: CandidateFile[] = [];
        const mainJsonlFiles = new Set<string>();

        try {
            const files = await fs.readdir(claudeDir, { recursive: true });
            const jsonlFiles = (files as string[])
                .filter(f => f.endsWith(".jsonl") && !f.includes("subagents"));

            for (const relPath of jsonlFiles) {
                const fullPath = `${claudeDir}/${relPath}`;

                // 检测 agent-*.jsonl，关联对应的 sessionId.jsonl
                if (relPath.match(/agent-[^/]+\.jsonl$/)) {
                    const sessionId = await this.extractSessionId(fullPath);
                    if (sessionId) {
                        const sessionJsonlPath = `${claudeDir}/${sessionId}.jsonl`;
                        mainJsonlFiles.add(sessionJsonlPath);
                    }
                }

                mainJsonlFiles.add(fullPath);
            }

            // 收集 mtime
            for (const path of mainJsonlFiles) {
                try {
                    const stat = await fs.stat(path);
                    candidates.push({ path, mtime: stat.mtime.getTime() });
                } catch {
                    // 文件可能已删除，跳过
                }
            }
        } catch {
            // 目录不存在或读取失败
        }

        return candidates;
    }

    /**
     * P0 Batch-1: 从 agent-*.jsonl 首行提取 sessionId
     */
    private async extractSessionId(agentJsonlPath: string): Promise<string | null> {
        try {
            const content = await readUtf8FromOffset(agentJsonlPath, 0);
            const firstLine = content.split("\n")[0];
            if (!firstLine) return null;

            const entry = JSON.parse(firstLine) as any;
            return entry.sessionId || null;
        } catch {
            return null;
        }
    }

    /**
     * P0 Batch-1: 候选文件打分
     * - deliverable 优先（前 30 行有 assistant 相关内容）
     * - 同类按 mtime 降序
     */
    private async scoreCandidates(candidates: CandidateFile[]): Promise<Array<CandidateFile & { score: number; isDeliverable: boolean }>> {
        const scored: Array<CandidateFile & { score: number; isDeliverable: boolean }> = [];

        for (const cand of candidates) {
            const isDeliverable = await this.checkDeliverable(cand.path);
            // deliverable 优先（分数 1000 + mtime），非 deliverable（mtime）
            const score = isDeliverable ? 1000000000000 + cand.mtime : cand.mtime;
            scored.push({ ...cand, score, isDeliverable });
        }

        // 按分数降序
        scored.sort((a, b) => b.score - a.score);
        return scored;
    }

    /**
     * P0 Batch-1: 检测文件是否 deliverable
     * 前 30 行内出现：type:"assistant" | message.role:"assistant" | payload.type in {message,assistant_message} | subtype:"stop_hook_summary"
     */
    private async checkDeliverable(filePath: string): Promise<boolean> {
        try {
            const content = await readUtf8FromOffset(filePath, 0);
            const lines = content.split("\n").slice(0, 30);

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const entry = JSON.parse(line) as any;

                    // 检测 deliverable 标志
                    if (entry.type === "assistant") return true;
                    if (entry.message?.role === "assistant") return true;
                    if (entry.payload?.type === "message" || entry.payload?.type === "assistant_message") return true;
                    if (entry.subtype === "stop_hook_summary") return true;
                } catch {
                    // 跳过无效行
                }
            }

            return false;
        } catch {
            return false;
        }
    }

    /**
     * 增量读取 JSONL 文件
     *
     * P0: offset 使用字节（byte），与 fs.stat().size 一致
     * 使用 createReadStream({ start }) 从字节偏移读取，避免中文 UTF-8 编码问题
     */
    async read(filePath: string): Promise<ReadResult> {
        const position = this.positions.get(filePath);
        const startOffset = position?.offset || 0;

        try {
            // 获取文件字节数（P0: 使用 fs.stat().size 而非 content.length）
            const stat = await fs.stat(filePath);
            const fileBytes = stat.size;

            // 如果文件变小了（被重写），从头开始读
            const actualStart = fileBytes < startOffset ? 0 : startOffset;

            // 从字节偏移读取内容（P0: 使用 readUtf8FromOffset）
            const newContent = await readUtf8FromOffset(filePath, actualStart);

            // P0 调试：记录读取信息
            if (process.env.DEBUG_TRACE === "1") {
                console.log(`[Reader] 读取 ${filePath}:`, {
                    startOffset,
                    actualStart,
                    fileBytes,
                    newContentLength: newContent.length,
                    linesCount: newContent.split("\n").filter(Boolean).length,
                });
            }

            // 解析新增的行
            const entries: JSONLEntry[] = [];
            const lines = newContent.split("\n").filter(Boolean);

            for (const line of lines) {
                try {
                    const entry = JSON.parse(line) as JSONLEntry;
                    entries.push(entry);
                } catch (parseError) {
                    // P0 调试：记录解析失败的行
                    if (process.env.DEBUG_TRACE === "1") {
                        console.warn(`[Reader] JSON 解析失败，跳过该行:`, {
                            module: "reader",
                            linePreview: line.slice(0, 100),
                            error: parseError instanceof Error ? parseError.message : String(parseError),
                        });
                    }
                    // 跳过无效行
                }
            }

            // 更新位置（P0: 使用字节 offset）
            this.positions.set(filePath, {
                filePath,
                offset: fileBytes,
            });

            return {
                entries,
                bytesRead: fileBytes - actualStart,
                newOffset: fileBytes,
            };
        } catch (error: any) {
            if (error.code === "ENOENT") {
                // 文件不存在，重置位置
                this.positions.delete(filePath);
                return { entries: [], bytesRead: 0, newOffset: 0 };
            }
            // P1 修复：记录读取失败日志
            console.error(`[Reader] JSONL 读取失败: ${filePath}`, error.message);
            throw error;
        }
    }

    /**
     * 读取指定项目的最新输出
     * P0 Batch-1: 返回 selectionInfo 用于日志
     */
    async readProject(projectDir?: string): Promise<ReadResult> {
        const findResult = await this.findLatestJsonlWithInfo(projectDir);
        if (!findResult) {
            // E16: trace 未找到文件的情况
            if (process.env.DEBUG_TRACE === "1") {
                console.log(`[Reader] 未找到 JSONL 文件，projectDir: ${projectDir}`);
            }
            return { entries: [], bytesRead: 0, newOffset: 0 };
        }

        const { path: filePath, selectionInfo } = findResult;

        // E16: trace 找到的文件路径
        if (process.env.DEBUG_TRACE === "1") {
            console.log(`[Reader] 找到 JSONL: ${filePath}`, selectionInfo);
        }

        const result = await this.read(filePath);
        result.selectionInfo = selectionInfo;
        return result;
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
