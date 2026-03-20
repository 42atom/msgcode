import fs from "node:fs";
import path from "node:path";

export type WorkspaceStatusKind = "decision" | "state";

export interface WorkspaceStatusRecord {
  timestamp: string;
  thread: string;
  kind: WorkspaceStatusKind;
  summary: string;
  refPath: string;
  refLine: number;
  ref: string;
  raw: string;
}

export interface AppendWorkspaceStatusInput {
  workspacePath: string;
  thread: string;
  kind: WorkspaceStatusKind;
  summary: string;
  refPath: string;
  refLine: number;
  timestamp?: string | number | Date;
}

export interface AppendWorkspaceStatusResult {
  filePath: string;
  written: boolean;
  record: WorkspaceStatusRecord;
}

export interface ReadWorkspaceStatusTailInput {
  workspacePath: string;
}

const DEFAULT_TAIL_LIMIT = 10;
const TAIL_CHUNK_SIZE = 4096;

export function getWorkspaceStatusLogPath(workspacePath: string): string {
  return path.join(workspacePath, ".msgcode", "status.log");
}

export function appendWorkspaceStatus(input: AppendWorkspaceStatusInput): AppendWorkspaceStatusResult {
  const filePath = getWorkspaceStatusLogPath(input.workspacePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const record = createWorkspaceStatusRecord(input);
  fs.appendFileSync(filePath, `${record.raw}\n`, "utf8");

  return {
    filePath,
    written: true,
    record,
  };
}

export function readWorkspaceStatusTail(input: ReadWorkspaceStatusTailInput): WorkspaceStatusRecord[] {
  const filePath = getWorkspaceStatusLogPath(input.workspacePath);
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const lines = readTailLines(filePath, DEFAULT_TAIL_LIMIT);
  const parsed = lines
    .map((line) => parseWorkspaceStatusLine(line))
    .filter((record): record is WorkspaceStatusRecord => record !== null);

  return parsed.reverse();
}

function createWorkspaceStatusRecord(input: AppendWorkspaceStatusInput): WorkspaceStatusRecord {
  const timestamp = normalizeTimestamp(input.timestamp);
  const thread = sanitizeRequiredCell(input.thread, "status.log thread 不能为空");
  const kind = input.kind;
  const summary = sanitizeRequiredCell(input.summary, "status.log summary 不能为空");
  const refPath = normalizeRefPath(input.workspacePath, input.refPath);
  const refLine = normalizeRefLine(input.refLine);
  const ref = `${refPath}#L${refLine}`;
  const raw = `${timestamp} | ${thread} | ${kind} | ${summary} | ${ref}`;

  return {
    timestamp,
    thread,
    kind,
    summary,
    refPath,
    refLine,
    ref,
    raw,
  };
}

function normalizeTimestamp(value?: string | number | Date): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "number") {
    return new Date(value).toISOString();
  }
  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) {
      return new Date().toISOString();
    }
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error("status.log timestamp 非法");
    }
    return parsed.toISOString();
  }
  return new Date().toISOString();
}

function normalizeRefLine(value: number): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error("status.log refLine 必须是 >= 1 的整数");
  }
  return value;
}

function normalizeRefPath(workspacePath: string, refPath: string): string {
  const raw = String(refPath || "").trim();
  if (!raw) {
    throw new Error("status.log refPath 不能为空");
  }

  const normalizedWorkspace = path.resolve(workspacePath);
  const absolute = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(normalizedWorkspace, raw);

  if (!absolute.startsWith(normalizedWorkspace + path.sep) && absolute !== normalizedWorkspace) {
    throw new Error("status.log refPath 必须位于当前工作区内");
  }

  const relative = path.relative(normalizedWorkspace, absolute).split(path.sep).join("/");
  return sanitizeCell(relative);
}

function sanitizeCell(value: string): string {
  return String(value)
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\|/g, "｜")
    .trim();
}

function sanitizeRequiredCell(value: string, message: string): string {
  const sanitized = sanitizeCell(value);
  if (!sanitized) {
    throw new Error(message);
  }
  return sanitized;
}

function parseWorkspaceStatusLine(line: string): WorkspaceStatusRecord | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  const parts = trimmed.split(" | ");
  if (parts.length !== 5) {
    return null;
  }

  const [timestamp, thread, kindRaw, summary, refRaw] = parts;
  if (kindRaw !== "decision" && kindRaw !== "state") {
    return null;
  }

  const match = refRaw.match(/^(.*)#L(\d+)$/);
  if (!match) {
    return null;
  }

  const refPath = match[1]?.trim() ?? "";
  const refLine = Number.parseInt(match[2] ?? "", 10);
  if (!refPath || !Number.isInteger(refLine) || refLine < 1) {
    return null;
  }

  return {
    timestamp: timestamp.trim(),
    thread: thread.trim(),
    kind: kindRaw,
    summary: summary.trim(),
    refPath,
    refLine,
    ref: `${refPath}#L${refLine}`,
    raw: trimmed,
  };
}

function readTailLines(filePath: string, limit: number): string[] {
  if (limit < 1) {
    return [];
  }

  const fd = fs.openSync(filePath, "r");
  try {
    const stat = fs.fstatSync(fd);
    let position = stat.size;
    const chunks: Buffer[] = [];
    let lineCount = 0;

    while (position > 0 && lineCount <= limit) {
      const start = Math.max(0, position - TAIL_CHUNK_SIZE);
      const length = position - start;
      const chunk = Buffer.alloc(length);
      fs.readSync(fd, chunk, 0, length, start);
      chunks.unshift(chunk);
      position = start;

      const text = Buffer.concat(chunks).toString("utf8");
      lineCount = text.split(/\r?\n/).filter((line) => line.trim()).length;
    }

    const content = Buffer.concat(chunks).toString("utf8");
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-limit);
  } finally {
    fs.closeSync(fd);
  }
}
