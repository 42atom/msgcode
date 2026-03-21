import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { Diagnostic } from "../memory/types.js";

export interface WorkspaceArchiveWorkspaceEntry {
  name: string;
  path: string;
  updatedAt: string;
}

export interface WorkspaceArchiveThreadEntry {
  threadId: string;
  chatId: string;
  title: string;
  source: string;
  archivedPath: string;
  lastTurnAt: string;
}

export interface WorkspaceArchiveSurfaceData {
  workspacePath: string;
  workspaceArchiveRoot: string;
  archivedThreadsPath: string;
  archivedWorkspaces: WorkspaceArchiveWorkspaceEntry[];
  archivedThreads: WorkspaceArchiveThreadEntry[];
}

export function getWorkspaceArchiveRoot(workspacePath: string): string {
  return path.join(path.dirname(workspacePath), ".archive");
}

export function getWorkspaceArchivedThreadsPath(workspacePath: string): string {
  return path.join(workspacePath, ".msgcode", "archived-threads");
}

export async function readWorkspaceArchiveSurface(workspacePath: string): Promise<{ data: WorkspaceArchiveSurfaceData; warnings: Diagnostic[] }> {
  const workspaceArchiveRoot = getWorkspaceArchiveRoot(workspacePath);
  const archivedThreadsPath = getWorkspaceArchivedThreadsPath(workspacePath);
  const warnings: Diagnostic[] = [];

  const archivedWorkspaces = await readArchivedWorkspaces(workspaceArchiveRoot, warnings);
  const archivedThreads = await readArchivedThreads(archivedThreadsPath, warnings);

  return {
    data: {
      workspacePath,
      workspaceArchiveRoot,
      archivedThreadsPath,
      archivedWorkspaces,
      archivedThreads,
    },
    warnings,
  };
}

async function readArchivedWorkspaces(rootPath: string, warnings: Diagnostic[]): Promise<WorkspaceArchiveWorkspaceEntry[]> {
  if (!existsSync(rootPath)) {
    return [];
  }

  const entries = await readdir(rootPath, { withFileTypes: true });
  const workspaces: WorkspaceArchiveWorkspaceEntry[] = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))) {
    const entryPath = path.join(rootPath, entry.name);
    if (!entry.isDirectory()) {
      warnings.push({
        code: "WORKSPACE_ARCHIVE_ROOT_INVALID_ENTRY",
        message: "archive 根目录存在非工作区项",
        hint: "只保留工作区目录",
        details: { rootPath, entryPath },
      });
      continue;
    }

    const info = await stat(entryPath);
    workspaces.push({
      name: entry.name,
      path: entryPath,
      updatedAt: info.mtime.toISOString(),
    });
  }

  return workspaces.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function readArchivedThreads(threadsPath: string, warnings: Diagnostic[]): Promise<WorkspaceArchiveThreadEntry[]> {
  if (!existsSync(threadsPath)) {
    return [];
  }

  const fileNames = (await readdir(threadsPath))
    .filter((name) => name.endsWith(".md"))
    .sort((a, b) => a.localeCompare(b, "zh-CN"));

  const threads: WorkspaceArchiveThreadEntry[] = [];
  for (const fileName of fileNames) {
    const filePath = path.join(threadsPath, fileName);
    try {
      const content = await readFile(filePath, "utf8");
      const thread = parseArchivedThread(filePath, content);
      if (!thread) {
        warnings.push({
          code: "WORKSPACE_ARCHIVED_THREAD_INVALID_FILE",
          message: "归档线程文件解析失败",
          hint: "修正 archived-threads 下的 markdown front matter 与 turn 标题",
          details: { filePath },
        });
        continue;
      }
      threads.push(thread);
    } catch (error) {
      warnings.push({
        code: "WORKSPACE_ARCHIVED_THREAD_READ_FAILED",
        message: "归档线程文件读取失败",
        hint: "检查 archived-threads 下的文件是否可读",
        details: { filePath, error: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  return threads.sort((a, b) => b.lastTurnAt.localeCompare(a.lastTurnAt));
}

function parseArchivedThread(filePath: string, content: string): WorkspaceArchiveThreadEntry | null {
  const match = content.match(/^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/);
  if (!match) {
    return null;
  }

  const frontMatter = parseSimpleFrontMatter(match[1] ?? "");
  const threadId = normalizeCell(frontMatter.threadId);
  const chatId = normalizeCell(frontMatter.chatId);
  if (!threadId || !chatId) {
    return null;
  }

  const turnHeaders = Array.from((match[2] ?? "").matchAll(/^## Turn \d+ - (.+)$/gm))
    .map((header) => normalizeCell(header[1]))
    .filter(Boolean);
  if (turnHeaders.length === 0) {
    return null;
  }

  return {
    threadId,
    chatId,
    title: deriveThreadTitle(frontMatter, filePath),
    source: deriveThreadSource(frontMatter, chatId),
    archivedPath: filePath,
    lastTurnAt: turnHeaders.sort((a, b) => b.localeCompare(a))[0] ?? "",
  };
}

function parseSimpleFrontMatter(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const index = line.indexOf(":");
    if (index < 0) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (!key) continue;
    result[key] = value;
  }
  return result;
}

function deriveThreadTitle(frontMatter: Record<string, string>, filePath: string): string {
  const explicitTitle = normalizeCell(frontMatter.title);
  if (explicitTitle) {
    return explicitTitle;
  }

  const baseName = path.basename(filePath, ".md");
  const title = baseName.replace(/^\d{4}-\d{2}-\d{2}_/, "");
  return title.trim() || baseName;
}

function deriveThreadSource(frontMatter: Record<string, string>, chatId: string): string {
  const explicitTransport = normalizeCell(frontMatter.transport).toLowerCase();
  if (explicitTransport) {
    return explicitTransport;
  }

  const raw = chatId.toLowerCase();
  if (raw.startsWith("feishu:")) return "feishu";
  if (raw.startsWith("web:")) return "web";
  if (raw.startsWith("neighbor:")) return "neighbor";
  return "unknown";
}

function normalizeCell(value: unknown): string {
  return String(value ?? "").trim();
}
