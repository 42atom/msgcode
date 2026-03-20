import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Diagnostic } from "../memory/types.js";

export type WorkspaceNeighborState = "discovered" | "known" | "contact";
export type WorkspaceNeighborDirection = "in" | "out" | "system";
export type WorkspaceNeighborMailboxType = "hello" | "handshake" | "message" | "delivery";

export interface WorkspaceNeighborNode {
  nodeId: string;
  displayName: string;
  state: WorkspaceNeighborState;
  lastMessageAt: string;
  lastProbeAt: string;
  lastProbeOk: boolean | null;
  latencyMs: number | null;
  unreadCount: number;
}

export interface WorkspaceNeighborMailboxEntry {
  at: string;
  nodeId: string;
  direction: WorkspaceNeighborDirection;
  type: WorkspaceNeighborMailboxType;
  summary: string;
  unread: boolean;
}

export interface WorkspaceNeighborSurfaceData {
  workspacePath: string;
  configPath: string;
  neighborsPath: string;
  mailboxPath: string;
  enabled: boolean;
  self: {
    nodeId: string;
    publicIdentity: string;
  };
  summary: {
    unreadCount: number;
    lastMessageAt: string;
    lastProbeAt: string;
    reachableCount: number;
  };
  neighbors: WorkspaceNeighborNode[];
  mailbox: {
    updatedAt: string;
    entries: WorkspaceNeighborMailboxEntry[];
  };
}

interface RawNeighborNode {
  nodeId: string;
  displayName: string;
  state: WorkspaceNeighborState;
  lastMessageAt: string;
  lastProbeAt: string;
  lastProbeOk: boolean | null;
  latencyMs: number | null;
}

const MAILBOX_TAIL_LIMIT = 80;

export function getWorkspaceNeighborConfigPath(workspacePath: string): string {
  return path.join(workspacePath, ".msgcode", "neighbor", "config.json");
}

export function getWorkspaceNeighborListPath(workspacePath: string): string {
  return path.join(workspacePath, ".msgcode", "neighbor", "neighbors.json");
}

export function getWorkspaceNeighborMailboxPath(workspacePath: string): string {
  return path.join(workspacePath, ".msgcode", "neighbor", "mailbox.jsonl");
}

export async function readWorkspaceNeighborSurface(workspacePath: string): Promise<{ data: WorkspaceNeighborSurfaceData; warnings: Diagnostic[] }> {
  const configPath = getWorkspaceNeighborConfigPath(workspacePath);
  const neighborsPath = getWorkspaceNeighborListPath(workspacePath);
  const mailboxPath = getWorkspaceNeighborMailboxPath(workspacePath);
  const warnings: Diagnostic[] = [];

  const config = await readNeighborConfig(configPath, warnings);
  const neighborList = await readNeighborList(neighborsPath, warnings);
  const mailboxEntries = await readNeighborMailbox(mailboxPath, warnings);

  const unreadByNode = new Map<string, number>();
  for (const entry of mailboxEntries) {
    if (!entry.unread) continue;
    unreadByNode.set(entry.nodeId, (unreadByNode.get(entry.nodeId) ?? 0) + 1);
  }

  const mergedNeighbors: WorkspaceNeighborNode[] = neighborList.map((node) => ({
    ...node,
    unreadCount: unreadByNode.get(node.nodeId) ?? 0,
  }));

  const mailbox = mailboxEntries;

  const lastMessageAt = mailbox[0]?.at ?? mergedNeighbors.map((node) => node.lastMessageAt).filter(Boolean).sort((a, b) => b.localeCompare(a))[0] ?? "";
  const lastProbeAt = mergedNeighbors.map((node) => node.lastProbeAt).filter(Boolean).sort((a, b) => b.localeCompare(a))[0] ?? "";
  const reachableCount = mergedNeighbors.filter((node) => node.lastProbeOk === true).length;

  return {
    data: {
      workspacePath,
      configPath,
      neighborsPath,
      mailboxPath,
      enabled: config.enabled,
      self: {
        nodeId: config.nodeId,
        publicIdentity: config.publicIdentity,
      },
      summary: {
        unreadCount: Array.from(unreadByNode.values()).reduce((sum, count) => sum + count, 0),
        lastMessageAt,
        lastProbeAt,
        reachableCount,
      },
      neighbors: mergedNeighbors,
      mailbox: {
        updatedAt: mailbox[0]?.at ?? "",
        entries: mailbox,
      },
    },
    warnings,
  };
}

async function readNeighborConfig(
  sourcePath: string,
  warnings: Diagnostic[]
): Promise<{ enabled: boolean; nodeId: string; publicIdentity: string }> {
  if (!existsSync(sourcePath)) {
    return { enabled: false, nodeId: "", publicIdentity: "" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(sourcePath, "utf8"));
  } catch (error) {
    warnings.push({
      code: "WORKSPACE_NEIGHBOR_CONFIG_INVALID_JSON",
      message: "neighbor/config.json 不是合法 JSON",
      hint: "修正 .msgcode/neighbor/config.json",
      details: { sourcePath, error: error instanceof Error ? error.message : String(error) },
    });
    return { enabled: false, nodeId: "", publicIdentity: "" };
  }

  if (!isRecord(parsed)) {
    warnings.push({
      code: "WORKSPACE_NEIGHBOR_CONFIG_INVALID_SCHEMA",
      message: "neighbor/config.json 顶层结构不符合约定",
      hint: "顶层必须是对象",
      details: { sourcePath },
    });
    return { enabled: false, nodeId: "", publicIdentity: "" };
  }

  return {
    enabled: parsed.enabled === true,
    nodeId: normalizeCell(parsed.nodeId),
    publicIdentity: normalizeCell(parsed.publicIdentity),
  };
}

async function readNeighborList(sourcePath: string, warnings: Diagnostic[]): Promise<RawNeighborNode[]> {
  if (!existsSync(sourcePath)) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(sourcePath, "utf8"));
  } catch (error) {
    warnings.push({
      code: "WORKSPACE_NEIGHBOR_LIST_INVALID_JSON",
      message: "neighbor/neighbors.json 不是合法 JSON",
      hint: "修正 .msgcode/neighbor/neighbors.json",
      details: { sourcePath, error: error instanceof Error ? error.message : String(error) },
    });
    return [];
  }

  if (!Array.isArray(parsed) && !(isRecord(parsed) && Array.isArray(parsed.neighbors))) {
    warnings.push({
      code: "WORKSPACE_NEIGHBOR_LIST_INVALID_SCHEMA",
      message: "neighbor/neighbors.json 顶层结构不符合约定",
      hint: "顶层应为数组，或提供 neighbors 数组",
      details: { sourcePath },
    });
    return [];
  }

  const rawItems: unknown[] = Array.isArray(parsed) ? parsed : (parsed.neighbors as unknown[]);

  const neighbors: RawNeighborNode[] = [];
  for (const [index, raw] of rawItems.entries()) {
    if (!isRecord(raw)) {
      warnings.push({
        code: "WORKSPACE_NEIGHBOR_INVALID_ENTRY",
        message: "neighbors.json 含有非法节点项",
        hint: "每个节点项都必须是对象",
        details: { sourcePath, index },
      });
      continue;
    }

    const nodeId = normalizeCell(raw.nodeId);
    const displayName = normalizeCell(raw.displayName) || nodeId;
    const state = normalizeNeighborState(raw.state);
    const lastMessageAt = normalizeCell(raw.lastMessageAt);
    const lastProbeAt = normalizeCell(raw.lastProbeAt);
    const lastProbeOk = normalizeOptionalBoolean(raw.lastProbeOk);
    const latencyMs = normalizeOptionalNumber(raw.latencyMs);

    if (!nodeId || !state) {
      warnings.push({
        code: "WORKSPACE_NEIGHBOR_INCOMPLETE",
        message: "neighbors.json 含有缺字段节点项",
        hint: "每个节点至少包含 nodeId 与合法 state",
        details: { sourcePath, index, nodeId, state: raw.state },
      });
      continue;
    }

    neighbors.push({
      nodeId,
      displayName,
      state,
      lastMessageAt,
      lastProbeAt,
      lastProbeOk,
      latencyMs,
    });
  }

  return neighbors.sort((a, b) => {
    const left = a.lastMessageAt || a.lastProbeAt;
    const right = b.lastMessageAt || b.lastProbeAt;
    return right.localeCompare(left);
  });
}

async function readNeighborMailbox(sourcePath: string, warnings: Diagnostic[]): Promise<WorkspaceNeighborMailboxEntry[]> {
  if (!existsSync(sourcePath)) {
    return [];
  }

  const content = await readFile(sourcePath, "utf8");
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const entries: WorkspaceNeighborMailboxEntry[] = [];
  for (const [index, line] of lines.entries()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      warnings.push({
        code: "WORKSPACE_NEIGHBOR_MAILBOX_INVALID_JSONL",
        message: "neighbor/mailbox.jsonl 含有非法 JSONL 行",
        hint: "修正该行，或移走坏记录",
        details: { sourcePath, line: index + 1, error: error instanceof Error ? error.message : String(error) },
      });
      continue;
    }

    if (!isRecord(parsed)) {
      warnings.push({
        code: "WORKSPACE_NEIGHBOR_MAILBOX_INVALID_ENTRY",
        message: "neighbor/mailbox.jsonl 含有非法记录",
        hint: "每行都必须是对象",
        details: { sourcePath, line: index + 1 },
      });
      continue;
    }

    const at = normalizeCell(parsed.at);
    const nodeId = normalizeCell(parsed.nodeId);
    const direction = normalizeDirection(parsed.direction);
    const type = normalizeMailboxType(parsed.type);
    const summary = normalizeCell(parsed.summary);
    const unread = parsed.unread === true;

    if (!at || !nodeId || !direction || !type || !summary) {
      warnings.push({
        code: "WORKSPACE_NEIGHBOR_MAILBOX_INCOMPLETE",
        message: "neighbor/mailbox.jsonl 含有缺字段记录",
        hint: "每行至少包含 at / nodeId / direction / type / summary",
        details: { sourcePath, line: index + 1 },
      });
      continue;
    }

    entries.push({
      at,
      nodeId,
      direction,
      type,
      summary,
      unread,
    });
  }

  return entries
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, MAILBOX_TAIL_LIMIT);
}

function normalizeNeighborState(value: unknown): WorkspaceNeighborState | "" {
  const normalized = normalizeCell(value);
  if (normalized === "discovered" || normalized === "known" || normalized === "contact") {
    return normalized;
  }
  return "";
}

function normalizeDirection(value: unknown): WorkspaceNeighborDirection | "" {
  const normalized = normalizeCell(value);
  if (normalized === "in" || normalized === "out" || normalized === "system") {
    return normalized;
  }
  return "";
}

function normalizeMailboxType(value: unknown): WorkspaceNeighborMailboxType | "" {
  const normalized = normalizeCell(value);
  if (normalized === "hello" || normalized === "handshake" || normalized === "message" || normalized === "delivery") {
    return normalized;
  }
  return "";
}

function normalizeOptionalBoolean(value: unknown): boolean | null {
  if (value === true) return true;
  if (value === false) return false;
  return null;
}

function normalizeOptionalNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return value;
}

function normalizeCell(value: unknown): string {
  return String(value ?? "").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
