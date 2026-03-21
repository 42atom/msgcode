import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { atomicWriteFile } from "./fs-atomic.js";
import {
  getWorkspaceCharacterIdentityCsvPath,
  normalizeCell,
  normalizeRequiredCell,
  parseWorkspacePeopleCsv,
  renderWorkspacePeopleCsv,
  type WorkspacePeopleCsvRow,
} from "./workspace-people-csv.js";

export interface SaveWorkspacePersonInput {
  workspacePath: string;
  channel: string;
  chatId: string;
  senderId: string;
  alias: string;
  notes?: string;
}

export interface SaveWorkspacePersonResult {
  workspacePath: string;
  filePath: string;
  created: boolean;
  row: WorkspacePeopleCsvRow;
}

export async function saveWorkspacePerson(input: SaveWorkspacePersonInput): Promise<SaveWorkspacePersonResult> {
  const workspacePath = input.workspacePath;
  const channel = normalizeRequiredCell(input.channel, "人物 channel 不能为空");
  const chatId = normalizeRequiredCell(input.chatId, "人物 chatId 不能为空");
  const senderId = normalizeRequiredCell(input.senderId, "人物 senderId 不能为空");
  const alias = normalizeRequiredSingleLineCell(input.alias, "人物 alias 不能为空");
  const notes = normalizeSingleLineCell(input.notes);
  const filePath = getWorkspaceCharacterIdentityCsvPath(workspacePath, channel, chatId);

  const rows = existsSync(filePath)
    ? parseWorkspacePeopleCsv(await readFile(filePath, "utf8"))
    : [];

  const now = new Date().toISOString();
  const index = rows.findIndex((row) =>
    row.channel === channel && row.chatId === chatId && row.senderId === senderId
  );

  let row: WorkspacePeopleCsvRow;
  let created = false;
  if (index >= 0) {
    const previous = rows[index]!;
    row = {
      ...previous,
      alias,
      notes,
      lastSeenAt: now,
    };
    rows[index] = row;
  } else {
    created = true;
    row = {
      channel,
      chatId,
      senderId,
      alias,
      role: "",
      notes,
      firstSeenAt: now,
      lastSeenAt: now,
    };
    rows.push(row);
  }

  await atomicWriteFile(filePath, renderWorkspacePeopleCsv(rows));

  return {
    workspacePath,
    filePath,
    created,
    row,
  };
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
