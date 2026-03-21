import path from "node:path";

export interface WorkspacePeopleCsvRow {
  channel: string;
  chatId: string;
  senderId: string;
  alias: string;
  role: string;
  notes: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

export const WORKSPACE_PEOPLE_CSV_HEADERS = [
  "channel",
  "chat_id",
  "sender_id",
  "alias",
  "role",
  "notes",
  "first_seen_at",
  "last_seen_at",
] as const;

export function getWorkspaceCharacterIdentityCsvPath(workspacePath: string, channel: string, chatId: string): string {
  const normalizedChannel = normalizeRequiredCell(channel, "人物 channel 不能为空");
  const normalizedChatId = normalizeRequiredCell(chatId, "人物 chatId 不能为空");
  const token = deriveChatToken(normalizedChannel, normalizedChatId);
  return path.join(workspacePath, ".msgcode", "character-identity", `${normalizedChannel}-${token}.csv`);
}

export function parseWorkspacePeopleCsv(content: string): WorkspacePeopleCsvRow[] {
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

    return {
      channel: normalizeCell(row.channel),
      chatId: normalizeCell(row.chat_id),
      senderId: normalizeCell(row.sender_id),
      alias: normalizeCell(row.alias),
      role: normalizeCell(row.role),
      notes: normalizeCell(row.notes),
      firstSeenAt: normalizeCell(row.first_seen_at),
      lastSeenAt: normalizeCell(row.last_seen_at),
    };
  });
}

export function renderWorkspacePeopleCsv(rows: WorkspacePeopleCsvRow[]): string {
  const lines = [
    WORKSPACE_PEOPLE_CSV_HEADERS.join(","),
    ...rows.map((row) => [
      row.channel,
      row.chatId,
      row.senderId,
      row.alias,
      row.role,
      row.notes,
      row.firstSeenAt,
      row.lastSeenAt,
    ].map(renderCsvCell).join(",")),
  ];

  return `${lines.join("\n")}\n`;
}

function deriveChatToken(channel: string, chatId: string): string {
  const prefix = `${channel}:`;
  const raw = chatId.startsWith(prefix) ? chatId.slice(prefix.length) : chatId;
  const normalized = raw
    .trim()
    .replace(/[\\/]/g, "-")
    .replace(/\s+/g, "-");
  if (!normalized) {
    throw new Error("人物 chatId 不能推导出 CSV 文件名");
  }
  return normalized;
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

function renderCsvCell(value: string): string {
  const raw = String(value ?? "");
  if (/[",\n\r]/.test(raw)) {
    return `"${raw.replace(/"/g, "\"\"")}"`;
  }
  return raw;
}

export function normalizeCell(value: unknown): string {
  return String(value ?? "").trim();
}

export function normalizeRequiredCell(value: unknown, message: string): string {
  const normalized = normalizeCell(value);
  if (!normalized) {
    throw new Error(message);
  }
  return normalized;
}
