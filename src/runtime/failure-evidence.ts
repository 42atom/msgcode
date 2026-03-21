import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { atomicWriteFile } from "./fs-atomic.js";

export type FailureSnapshotKind = "verify" | "runner" | "provider" | "inbound";

export interface TaskEvidenceCommand {
  command: string;
  exitCode: number;
  ok: boolean;
  stdoutTail: string;
  stderrTail: string;
  durationMs: number;
  fullOutputPath?: string;
  error?: string;
}

export interface TaskEvidenceRecord {
  taskId: string;
  ok: boolean;
  exitCode: number;
  timestamp: string;
  commands: TaskEvidenceCommand[];
}

export interface FailureSnapshotRecord {
  kind: FailureSnapshotKind;
  timestamp: string;
  taskId?: string;
  pack?: string;
  exitCode?: number;
  command?: string;
  durationMs?: number;
  stdoutTail?: string;
  stderrTail?: string;
  error?: string;
  artifactRefs?: string[];
}

const EVIDENCE_DIR_NAME = ".msgcode/evidence";
const SNAPSHOT_FILE_RE = /^(verify|runner|provider|inbound)-\d{8}T\d{6}Z-[a-z0-9]+\.json$/i;
const DEFAULT_SNAPSHOT_FILE_LIMIT = 64 * 1024;
const DEFAULT_RETENTION_COUNT = 20;
const DEFAULT_RETENTION_DAYS = 7;

function getEvidenceDir(workspacePath: string): string {
  return path.join(workspacePath, EVIDENCE_DIR_NAME);
}

function clipText(text: string | undefined, maxChars: number): string | undefined {
  if (!text) return text;
  if (text.length <= maxChars) return text;
  if (maxChars <= 16) return text.slice(0, maxChars);
  return `${text.slice(0, maxChars - 14)}...(truncated)`;
}

function formatSnapshotTimestamp(isoTime: string): string {
  return isoTime.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function normalizeSnapshot(snapshot: FailureSnapshotRecord): FailureSnapshotRecord {
  return {
    ...snapshot,
    taskId: snapshot.taskId?.trim() || undefined,
    pack: snapshot.pack?.trim() || undefined,
    command: clipText(snapshot.command?.trim(), 200),
    stdoutTail: clipText(snapshot.stdoutTail, 1200),
    stderrTail: clipText(snapshot.stderrTail, 1200),
    error: clipText(snapshot.error, 400),
    artifactRefs: Array.from(new Set((snapshot.artifactRefs ?? []).filter(Boolean))).slice(0, 8),
  };
}

function encodeSnapshot(snapshot: FailureSnapshotRecord, maxBytes: number): string {
  const normalized = normalizeSnapshot(snapshot);
  let json = JSON.stringify(normalized, null, 2);
  if (Buffer.byteLength(json, "utf8") <= maxBytes) {
    return json;
  }

  const compressed: FailureSnapshotRecord = {
    kind: normalized.kind,
    timestamp: normalized.timestamp,
    taskId: normalized.taskId,
    pack: normalized.pack,
    exitCode: normalized.exitCode,
    command: clipText(normalized.command, 120),
    durationMs: normalized.durationMs,
    stdoutTail: clipText(normalized.stdoutTail, 256),
    stderrTail: clipText(normalized.stderrTail, 256),
    error: clipText(normalized.error, 160),
    artifactRefs: normalized.artifactRefs?.slice(0, 4),
  };
  json = JSON.stringify(compressed, null, 2);
  if (Buffer.byteLength(json, "utf8") <= maxBytes) {
    return json;
  }

  return JSON.stringify({
    kind: normalized.kind,
    timestamp: normalized.timestamp,
    taskId: normalized.taskId,
    pack: normalized.pack,
    exitCode: normalized.exitCode,
    command: clipText(normalized.command, 80),
    artifactRefs: normalized.artifactRefs?.slice(0, 2),
    note: "snapshot truncated to fit size limit",
  }, null, 2);
}

export function getTaskEvidencePath(workspacePath: string, taskId: string): string {
  return path.join(getEvidenceDir(workspacePath), `${taskId}.json`);
}

export function readTaskEvidence(workspacePath: string, taskId: string): TaskEvidenceRecord | null {
  const evidencePath = getTaskEvidencePath(workspacePath, taskId);
  if (!existsSync(evidencePath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(evidencePath, "utf8")) as TaskEvidenceRecord;
  } catch {
    return null;
  }
}

export async function writeTaskEvidence(
  workspacePath: string,
  taskId: string,
  evidence: TaskEvidenceRecord
): Promise<string> {
  const evidencePath = getTaskEvidencePath(workspacePath, taskId);
  await atomicWriteFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  return evidencePath;
}

export async function pruneFailureSnapshots(
  workspacePath: string,
  options?: {
    maxCount?: number;
    maxAgeDays?: number;
  }
): Promise<void> {
  const evidenceDir = getEvidenceDir(workspacePath);
  let entries: string[];
  try {
    entries = await readdir(evidenceDir);
  } catch {
    return;
  }

  const maxCount = options?.maxCount ?? DEFAULT_RETENTION_COUNT;
  const maxAgeDays = options?.maxAgeDays ?? DEFAULT_RETENTION_DAYS;
  const cutoffMs = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);

  const snapshots = await Promise.all(entries
    .filter((entry) => SNAPSHOT_FILE_RE.test(entry))
    .map(async (entry) => {
      const filePath = path.join(evidenceDir, entry);
      try {
        const fileStat = await stat(filePath);
        return { filePath, mtimeMs: fileStat.mtimeMs };
      } catch {
        return null;
      }
    }));

  const existing = snapshots.filter((item): item is { filePath: string; mtimeMs: number } => Boolean(item));
  const expired = existing.filter((item) => item.mtimeMs < cutoffMs);
  await Promise.all(expired.map((item) => unlink(item.filePath).catch(() => undefined)));

  const fresh = existing
    .filter((item) => item.mtimeMs >= cutoffMs)
    .sort((lhs, rhs) => rhs.mtimeMs - lhs.mtimeMs);

  if (fresh.length <= maxCount) {
    return;
  }

  await Promise.all(fresh
    .slice(maxCount)
    .map((item) => unlink(item.filePath).catch(() => undefined)));
}

export async function writeFailureSnapshot(
  workspacePath: string,
  snapshot: FailureSnapshotRecord,
  options?: {
    maxBytes?: number;
    maxCount?: number;
    maxAgeDays?: number;
  }
): Promise<string> {
  const timestamp = snapshot.timestamp || new Date().toISOString();
  const fileName = `${snapshot.kind}-${formatSnapshotTimestamp(timestamp)}-${randomUUID().replace(/-/g, "").slice(0, 8)}.json`;
  const filePath = path.join(getEvidenceDir(workspacePath), fileName);
  const content = encodeSnapshot({ ...snapshot, timestamp }, options?.maxBytes ?? DEFAULT_SNAPSHOT_FILE_LIMIT);
  await atomicWriteFile(filePath, `${content}\n`);
  await pruneFailureSnapshots(workspacePath, {
    maxCount: options?.maxCount,
    maxAgeDays: options?.maxAgeDays,
  });
  return filePath;
}
