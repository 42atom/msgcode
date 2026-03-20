import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Diagnostic } from "../memory/types.js";

export interface WorkspaceIdentityRecord {
  sourcePath: string;
  channel: string;
  chatId: string;
  senderId: string;
  alias: string;
  role: string;
  notes: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface WorkspacePendingPerson {
  channel: string;
  channelId: string;
  username: string;
  displayName: string;
  seenAt: string;
  sourcePath: string;
}

export interface WorkspacePeopleState {
  workspacePath: string;
  sourceDir: string;
  pendingPath: string;
  people: WorkspaceIdentityRecord[];
  pending: WorkspacePendingPerson[];
}

export function getWorkspaceCharacterIdentityDir(workspacePath: string): string {
  return path.join(workspacePath, ".msgcode", "character-identity");
}

export function getWorkspacePeoplePendingPath(workspacePath: string): string {
  return path.join(workspacePath, ".msgcode", "people-pending.json");
}

export async function readWorkspacePeopleState(workspacePath: string): Promise<{ data: WorkspacePeopleState; warnings: Diagnostic[] }> {
  const sourceDir = getWorkspaceCharacterIdentityDir(workspacePath);
  const pendingPath = getWorkspacePeoplePendingPath(workspacePath);
  const warnings: Diagnostic[] = [];

  const people = await readKnownPeople(sourceDir, warnings);
  const pending = await readPendingPeople(pendingPath, warnings);

  return {
    data: {
      workspacePath,
      sourceDir,
      pendingPath,
      people,
      pending,
    },
    warnings,
  };
}

async function readKnownPeople(sourceDir: string, warnings: Diagnostic[]): Promise<WorkspaceIdentityRecord[]> {
  if (!existsSync(sourceDir)) {
    return [];
  }

  const entries = (await readdir(sourceDir))
    .filter((name) => name.endsWith(".csv"))
    .sort((a, b) => a.localeCompare(b, "zh-CN"));

  const people: WorkspaceIdentityRecord[] = [];

  for (const fileName of entries) {
    const sourcePath = path.join(sourceDir, fileName);
    const content = await readFile(sourcePath, "utf8");
    const rows = parseCsvRows(content);
    if (rows.length === 0) {
      continue;
    }

    for (const [index, row] of rows.entries()) {
      const channel = normalizeCell(row.channel);
      const chatId = normalizeCell(row.chat_id);
      const channelId = normalizeCell(row.sender_id);
      const alias = normalizeCell(row.alias);
      const role = normalizeCell(row.role);
      const note = normalizeCell(row.notes);
      const firstSeenAt = normalizeCell(row.first_seen_at);
      const lastSeenAt = normalizeCell(row.last_seen_at);

      if (!channel || !chatId || !channelId) {
        warnings.push({
          code: "WORKSPACE_PEOPLE_INVALID_ROW",
          message: "人物 CSV 含有缺字段记录",
          hint: "每行至少包含 channel / chat_id / sender_id",
          details: { sourcePath, index: index + 2 },
        });
        continue;
      }

      people.push({
        sourcePath,
        channel,
        chatId,
        senderId: channelId,
        alias,
        role,
        notes: note,
        firstSeenAt,
        lastSeenAt,
      });
    }
  }

  return people;
}

async function readPendingPeople(pendingPath: string, warnings: Diagnostic[]): Promise<WorkspacePendingPerson[]> {
  if (!existsSync(pendingPath)) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(pendingPath, "utf8"));
  } catch (error) {
    warnings.push({
      code: "WORKSPACE_PEOPLE_PENDING_INVALID_JSON",
      message: "people-pending.json 不是合法 JSON",
      hint: "修正 JSON 或先移走该文件",
      details: { pendingPath, error: error instanceof Error ? error.message : String(error) },
    });
    return [];
  }

  const rawItems = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.pending)
      ? parsed.pending
      : [];

  const pending: WorkspacePendingPerson[] = [];
  for (const [index, raw] of rawItems.entries()) {
    if (!isRecord(raw)) {
      warnings.push({
        code: "WORKSPACE_PEOPLE_PENDING_INVALID_ENTRY",
        message: "people-pending.json 含有非法条目",
        hint: "每个待关联人物项都必须是对象",
        details: { pendingPath, index },
      });
      continue;
    }

    const channel = normalizeCell(raw.channel);
    const channelId = normalizeCell(raw.channelId);
    const username = normalizeCell(raw.username);
    const displayName = normalizeCell(raw.displayName);
    const seenAt = normalizeCell(raw.seenAt);

    if (!channel || !channelId) {
      warnings.push({
        code: "WORKSPACE_PEOPLE_PENDING_INCOMPLETE",
        message: "people-pending.json 含有缺字段条目",
        hint: "每个待关联人物项至少包含 channel / channelId",
        details: { pendingPath, index },
      });
      continue;
    }

    pending.push({
      channel,
      channelId,
      username,
      displayName,
      seenAt,
      sourcePath: pendingPath,
    });
  }

  return pending;
}

function parseCsvRows(content: string): Array<Record<string, string>> {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return [];
  }

  const headers = parseCsvLine(lines[0] ?? "");
  if (headers.length === 0) {
    return [];
  }

  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row: Record<string, string> = {};
    for (let i = 0; i < headers.length; i += 1) {
      const key = headers[i]?.trim();
      if (!key) continue;
      row[key] = values[i] ?? "";
    }
    return row;
  });
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === "\"") {
      const next = line[i + 1];
      if (inQuotes && next === "\"") {
        current += "\"";
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
}

function normalizeCell(value: unknown): string {
  return String(value ?? "").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
