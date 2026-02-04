/**
 * msgcode: Codex JSONL 输出读取器（T3: Codex 回复抽取）
 */

import { createReadStream, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface CodexJSONLEntry {
    timestamp?: string;
    type?: string;
    payload?: unknown;
    // 兼容未来字段（Codex JSONL schema 可能扩展）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSONL 结构由 Codex 产出，字段不稳定；解析处用 type-guard 收口
    [key: string]: any;
}

export interface CodexReadResult {
    entries: CodexJSONLEntry[];
    bytesRead: number;
    newOffset: number;
}

export interface CodexSessionMeta {
    id: string;
    cwd: string;
}

interface CodexReadPosition {
    filePath: string;
    offset: number;
}

type RolloutCandidate = { filePath: string; mtimeMs: number };

function getCodexSessionsDir(): string {
    // 允许通过环境变量覆盖（便于多用户/CI/自定义路径）
    const envDir = process.env.CODEX_SESSIONS_DIR?.trim();
    if (envDir) return envDir;
    return path.join(os.homedir(), ".codex", "sessions");
}

function isRolloutJsonlFile(name: string): boolean {
    return name.startsWith("rollout-") && name.endsWith(".jsonl");
}

async function listAllRolloutFiles(baseDir: string): Promise<RolloutCandidate[]> {
    const candidates: RolloutCandidate[] = [];

    // 目录结构：~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
    try {
        const years = await fs.readdir(baseDir, { withFileTypes: true });
        for (const year of years) {
            if (!year.isDirectory()) continue;
            const yearPath = path.join(baseDir, year.name);
            const months = await fs.readdir(yearPath, { withFileTypes: true });
            for (const month of months) {
                if (!month.isDirectory()) continue;
                const monthPath = path.join(yearPath, month.name);
                const days = await fs.readdir(monthPath, { withFileTypes: true });
                for (const day of days) {
                    if (!day.isDirectory()) continue;
                    const dayPath = path.join(monthPath, day.name);
                    const files = await fs.readdir(dayPath, { withFileTypes: true });
                    for (const file of files) {
                        if (!file.isFile()) continue;
                        if (!isRolloutJsonlFile(file.name)) continue;

                        const filePath = path.join(dayPath, file.name);
                        try {
                            const stat = await fs.stat(filePath);
                            candidates.push({ filePath, mtimeMs: stat.mtimeMs });
                        } catch {
                            // ignore
                        }
                    }
                }
            }
        }
    } catch {
        return [];
    }

    // 最近修改优先
    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return candidates;
}

async function readFirstLine(filePath: string): Promise<string> {
    // 仅读取第一行（session_meta），避免整文件读取
    const stream = createReadStream(filePath, { encoding: "utf8", start: 0 });
    let buf = "";

    return await new Promise<string>((resolve, reject) => {
        const cleanup = () => {
            stream.removeAllListeners();
            stream.destroy();
        };

        stream.on("data", (chunk: string) => {
            buf += chunk;
            const newline = buf.indexOf("\n");
            if (newline !== -1) {
                const line = buf.slice(0, newline);
                cleanup();
                resolve(line);
            }
            // 第一行极端情况很大时，防止无限增长（512KB 足够覆盖 session_meta）
            if (buf.length > 512 * 1024) {
                cleanup();
                resolve(buf);
            }
        });

        stream.on("error", err => {
            cleanup();
            reject(err);
        });

        stream.on("end", () => {
            cleanup();
            resolve(buf);
        });
    });
}

export async function readCodexSessionMeta(filePath: string): Promise<CodexSessionMeta | null> {
    try {
        const firstLine = await readFirstLine(filePath);
        if (!firstLine.trim()) return null;
        const meta = JSON.parse(firstLine) as { type?: string; payload?: { id?: unknown; cwd?: unknown } };
        if (meta.type !== "session_meta") return null;
        const id = meta.payload?.id;
        const cwd = meta.payload?.cwd;
        if (typeof id !== "string" || typeof cwd !== "string") return null;
        return { id, cwd };
    } catch {
        return null;
    }
}

async function matchesWorkspace(filePath: string, projectDir: string): Promise<boolean> {
    try {
        const firstLine = await readFirstLine(filePath);
        if (!firstLine.trim()) return false;
        const meta = JSON.parse(firstLine) as { type?: string; payload?: { cwd?: string } };
        return meta.type === "session_meta" && meta.payload?.cwd === projectDir;
    } catch {
        return false;
    }
}

async function readUtf8FromOffset(filePath: string, start: number): Promise<string> {
    const stream = createReadStream(filePath, { encoding: "utf8", start });
    return await new Promise<string>((resolve, reject) => {
        let data = "";
        stream.on("data", (chunk: string) => {
            data += chunk;
        });
        stream.on("end", () => resolve(data));
        stream.on("error", reject);
    });
}

export class CodexOutputReader {
    private positions = new Map<string, CodexReadPosition>();

    async findLatestJsonlForWorkspace(projectDir: string): Promise<string | null> {
        const baseDir = getCodexSessionsDir();
        const candidates = await listAllRolloutFiles(baseDir);
        for (const c of candidates) {
            // P0: 必须按 workspace 过滤，避免跨项目串味/泄露
            // 只要找到第一条匹配即可（已按 mtime 倒序）
            // eslint-disable-next-line no-await-in-loop -- 必须顺序验证（尽快 early-return）
            const ok = await matchesWorkspace(c.filePath, projectDir);
            if (ok) return c.filePath;
        }
        return null;
    }

    async read(filePath: string): Promise<CodexReadResult> {
        const position = this.positions.get(filePath);
        const startOffset = position?.offset || 0;

        try {
            const stat = await fs.stat(filePath);
            const fileBytes = stat.size;
            const actualStart = fileBytes < startOffset ? 0 : startOffset;

            const entries: CodexJSONLEntry[] = [];
            const newContent = await readUtf8FromOffset(filePath, actualStart);
            const lines = newContent.split("\n").filter(Boolean);

            for (const line of lines) {
                try {
                    const entry = JSON.parse(line) as CodexJSONLEntry;
                    entries.push(entry);
                } catch {
                    // Skip invalid lines
                }
            }

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
                this.positions.delete(filePath);
                return { entries: [], bytesRead: 0, newOffset: 0 };
            }
            throw error;
        }
    }

    async seekToEnd(filePath: string): Promise<number> {
        const stat = await fs.stat(filePath);
        this.setPosition(filePath, stat.size);
        return stat.size;
    }

    reset(filePath?: string): void {
        if (filePath) {
            this.positions.delete(filePath);
        } else {
            this.positions.clear();
        }
    }

    setPosition(filePath: string, offset: number): void {
        this.positions.set(filePath, { filePath, offset });
    }

    getPosition(filePath: string): number {
        return this.positions.get(filePath)?.offset || 0;
    }
}
