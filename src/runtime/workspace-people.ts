import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Diagnostic } from "../memory/types.js";
import { atomicWriteFile } from "./fs-atomic.js";
import { parseWorkspacePeopleCsv } from "./workspace-people-csv.js";

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
  chatId: string;
  senderId: string;
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

export interface SaveWorkspacePendingPersonInput {
  workspacePath: string;
  channel: string;
  chatId: string;
  senderId: string;
  username?: string;
  displayName?: string;
  seenAt?: string;
}

export interface SaveWorkspacePendingPersonResult {
  workspacePath: string;
  pendingPath: string;
  created: boolean;
  person: WorkspacePendingPerson;
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
  const pending = filterClaimedPending(
    await readPendingPeople(pendingPath, warnings),
    people,
  );

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

export async function saveWorkspacePendingPerson(
  input: SaveWorkspacePendingPersonInput,
): Promise<SaveWorkspacePendingPersonResult> {
  const workspacePath = input.workspacePath;
  const channel = normalizeRequiredSingleLineCell(input.channel, "待关联人物 channel 不能为空");
  const chatId = normalizeRequiredSingleLineCell(input.chatId, "待关联人物 chatId 不能为空");
  const senderId = normalizeRequiredSingleLineCell(input.senderId, "待关联人物 senderId 不能为空");
  const username = normalizeSingleLineCell(input.username);
  const displayName = normalizeSingleLineCell(input.displayName);
  const seenAt = normalizeSingleLineCell(input.seenAt) || new Date().toISOString();

  if (!username && !displayName) {
    throw new Error("待关联人物 username / displayName 至少要有一个");
  }

  const pendingPath = getWorkspacePeoplePendingPath(workspacePath);
  const pending = await readPendingPeopleForMutation(pendingPath);
  const key = buildPeopleKey(channel, chatId, senderId);
  const index = pending.findIndex((item) => buildPeopleKey(item.channel, item.chatId, item.senderId) === key);

  const person: WorkspacePendingPerson = {
    channel,
    chatId,
    senderId,
    username,
    displayName,
    seenAt,
    sourcePath: pendingPath,
  };

  let created = false;
  if (index >= 0) {
    pending[index] = person;
  } else {
    created = true;
    pending.push(person);
  }

  await atomicWriteFile(
    pendingPath,
    `${JSON.stringify({ pending: pending.map(stripPendingSourcePath) }, null, 2)}\n`,
  );

  return {
    workspacePath,
    pendingPath,
    created,
    person,
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
    const rows = parseWorkspacePeopleCsv(content);
    if (rows.length === 0) {
      continue;
    }

    for (const [index, row] of rows.entries()) {
      const channel = normalizeCell(row.channel);
      const chatId = normalizeCell(row.chatId);
      const channelId = normalizeCell(row.senderId);
      const alias = normalizeCell(row.alias);
      const role = normalizeCell(row.role);
      const note = normalizeCell(row.notes);
      const firstSeenAt = normalizeCell(row.firstSeenAt);
      const lastSeenAt = normalizeCell(row.lastSeenAt);

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
    const chatId = normalizeCell(raw.chatId);
    const senderId = normalizeCell(raw.senderId);
    const username = normalizeCell(raw.username);
    const displayName = normalizeCell(raw.displayName);
    const seenAt = normalizeCell(raw.seenAt);

    if (!channel || !chatId || !senderId) {
      warnings.push({
        code: "WORKSPACE_PEOPLE_PENDING_INCOMPLETE",
        message: "people-pending.json 含有缺字段条目",
        hint: "每个待关联人物项至少包含 channel / chatId / senderId",
        details: { pendingPath, index },
      });
      continue;
    }

    pending.push({
      channel,
      chatId,
      senderId,
      username,
      displayName,
      seenAt,
      sourcePath: pendingPath,
    });
  }

  return pending;
}

async function readPendingPeopleForMutation(pendingPath: string): Promise<WorkspacePendingPerson[]> {
  if (!existsSync(pendingPath)) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(pendingPath, "utf8"));
  } catch (error) {
    throw new Error(`people-pending.json 不是合法 JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  const rawItems = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.pending)
      ? parsed.pending
      : null;

  if (!rawItems) {
    throw new Error("people-pending.json 格式非法");
  }

  return rawItems.map((raw, index) => {
    if (!isRecord(raw)) {
      throw new Error(`people-pending.json 第 ${index + 1} 项不是对象`);
    }

    const channel = normalizeRequiredSingleLineCell(raw.channel, `people-pending.json 第 ${index + 1} 项缺少 channel`);
    const chatId = normalizeRequiredSingleLineCell(raw.chatId, `people-pending.json 第 ${index + 1} 项缺少 chatId`);
    const senderId = normalizeRequiredSingleLineCell(raw.senderId, `people-pending.json 第 ${index + 1} 项缺少 senderId`);
    const username = normalizeSingleLineCell(raw.username);
    const displayName = normalizeSingleLineCell(raw.displayName);
    const seenAt = normalizeSingleLineCell(raw.seenAt);

    return {
      channel,
      chatId,
      senderId,
      username,
      displayName,
      seenAt,
      sourcePath: pendingPath,
    };
  });
}

function filterClaimedPending(
  pending: WorkspacePendingPerson[],
  people: WorkspaceIdentityRecord[],
): WorkspacePendingPerson[] {
  const claimed = new Set(people.map((item) => buildPeopleKey(item.channel, item.chatId, item.senderId)));
  return pending.filter((item) => !claimed.has(buildPeopleKey(item.channel, item.chatId, item.senderId)));
}

function buildPeopleKey(channel: string, chatId: string, senderId: string): string {
  return `${channel}\u0000${chatId}\u0000${senderId}`;
}

function stripPendingSourcePath(person: WorkspacePendingPerson): Omit<WorkspacePendingPerson, "sourcePath"> {
  return {
    channel: person.channel,
    chatId: person.chatId,
    senderId: person.senderId,
    username: person.username,
    displayName: person.displayName,
    seenAt: person.seenAt,
  };
}

function normalizeCell(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeSingleLineCell(value: unknown): string {
  return normalizeCell(value).replace(/[\r\n]+/g, " ").trim();
}

function normalizeRequiredSingleLineCell(value: unknown, message: string): string {
  const normalized = normalizeSingleLineCell(value);
  if (!normalized) {
    throw new Error(message);
  }
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
