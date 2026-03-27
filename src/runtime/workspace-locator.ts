import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";

export interface WorkspaceIdentity {
  workspaceUid: string;
  createdAt: string;
  label: string;
}

function getWorkspaceRoot(): string {
  return path.resolve(process.env.WORKSPACE_ROOT || config.workspaceRoot);
}

function getWorkspaceIdentityPath(workspacePath: string): string {
  return path.join(workspacePath, ".msgcode", "workspace.json");
}

function isWorkspaceIdentityShape(value: unknown): value is WorkspaceIdentity {
  if (!value || typeof value !== "object") {
    return false;
  }

  const identity = value as Partial<WorkspaceIdentity>;
  return (
    typeof identity.workspaceUid === "string" &&
    typeof identity.createdAt === "string" &&
    typeof identity.label === "string"
  );
}

function normalizeWorkspaceLabel(workspacePath: string, label?: string): string {
  const normalized = label?.trim();
  if (normalized) {
    return normalized;
  }

  return path.basename(workspacePath) || "workspace";
}

function writeWorkspaceIdentity(workspacePath: string, identity: WorkspaceIdentity): void {
  fs.mkdirSync(path.dirname(getWorkspaceIdentityPath(workspacePath)), { recursive: true });
  fs.writeFileSync(getWorkspaceIdentityPath(workspacePath), `${JSON.stringify(identity, null, 2)}\n`, "utf8");
}

function shouldSkipDirectory(name: string): boolean {
  return name.startsWith(".") || name === "node_modules";
}

export function readWorkspaceIdentity(workspacePath: string): WorkspaceIdentity | null {
  const identityPath = getWorkspaceIdentityPath(workspacePath);
  if (!fs.existsSync(identityPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(identityPath, "utf8")) as unknown;
    return isWorkspaceIdentityShape(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function ensureWorkspaceIdentity(workspacePath: string, label?: string): WorkspaceIdentity {
  const existing = readWorkspaceIdentity(workspacePath);
  if (existing) {
    const nextLabel = normalizeWorkspaceLabel(workspacePath, label);
    if (existing.label !== nextLabel) {
      const updated: WorkspaceIdentity = {
        ...existing,
        label: nextLabel,
      };
      writeWorkspaceIdentity(workspacePath, updated);
      return updated;
    }

    return existing;
  }

  const identity: WorkspaceIdentity = {
    workspaceUid: randomUUID(),
    createdAt: new Date().toISOString(),
    label: normalizeWorkspaceLabel(workspacePath, label),
  };
  writeWorkspaceIdentity(workspacePath, identity);
  return identity;
}

export function resolveWorkspacePathByUid(workspaceUid: string): string | null {
  const workspaceRoot = getWorkspaceRoot();
  if (!fs.existsSync(workspaceRoot)) {
    return null;
  }

  const queue: string[] = [workspaceRoot];
  while (queue.length > 0) {
    const currentPath = queue.shift()!;
    const identity = readWorkspaceIdentity(currentPath);
    if (identity) {
      if (identity.workspaceUid === workspaceUid) {
        return currentPath;
      }
      continue;
    }

    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || shouldSkipDirectory(entry.name)) {
        continue;
      }
      queue.push(path.join(currentPath, entry.name));
    }
  }

  return null;
}
