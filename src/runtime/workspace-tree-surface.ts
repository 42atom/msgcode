import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import type { Diagnostic } from "../memory/types.js";
import { readWorkspaceThreadSummaries } from "./workspace-thread-surface.js";

export interface WorkspaceTreeThreadItem {
  threadId: string;
  title: string;
  source: string;
  lastTurnAt: string;
}

export interface WorkspaceTreeWorkspaceItem {
  name: string;
  path: string;
  threads: WorkspaceTreeThreadItem[];
}

export interface WorkspaceTreeSurfaceData {
  workspaceRoot: string;
  workspaceArchiveRoot: string;
  workspaces: WorkspaceTreeWorkspaceItem[];
}

export function getWorkspaceRootPath(): string {
  return process.env.WORKSPACE_ROOT || path.join(process.env.HOME || "", "msgcode-workspaces");
}

export function getWorkspaceRootArchivePath(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".archive");
}

export async function readWorkspaceTreeSurface(
  workspaceRoot = getWorkspaceRootPath(),
): Promise<{ data: WorkspaceTreeSurfaceData; warnings: Diagnostic[] }> {
  const warnings: Diagnostic[] = [];
  const workspaces = await readWorkspaceTreeWorkspaces(workspaceRoot, warnings);

  return {
    data: {
      workspaceRoot,
      workspaceArchiveRoot: getWorkspaceRootArchivePath(workspaceRoot),
      workspaces,
    },
    warnings,
  };
}

async function readWorkspaceTreeWorkspaces(
  workspaceRoot: string,
  warnings: Diagnostic[],
): Promise<WorkspaceTreeWorkspaceItem[]> {
  if (!existsSync(workspaceRoot)) {
    return [];
  }

  const entries = (await readdir(workspaceRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .filter((entry) => !entry.name.startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));

  const workspaces: WorkspaceTreeWorkspaceItem[] = [];
  for (const entry of entries) {
    const workspacePath = path.join(workspaceRoot, entry.name);
    const threads = await readWorkspaceThreadSummaries(workspacePath, warnings);
    workspaces.push({
      name: entry.name,
      path: workspacePath,
      threads: threads.map((thread) => ({
        threadId: thread.threadId,
        title: thread.title,
        source: thread.source,
        lastTurnAt: thread.lastTurnAt,
      })),
    });
  }

  return workspaces;
}
