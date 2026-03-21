import fs from "node:fs";
import path from "node:path";

export type TelemetryLedgerKind = "tool" | "verify" | "probe" | "runner";

export interface TelemetryLedgerEntry {
  ts: string;
  kind: TelemetryLedgerKind;
  source: string;
  name: string;
  ok: boolean;
  durationMs: number;
  workspace?: string;
  errorCode?: string;
  tokensIn?: number;
  tokensOut?: number;
  totalTokens?: number;
  count?: number;
}

const DEFAULT_RETENTION_DAYS = 7;
const LEDGER_FILE_RE = /^telemetry-\d{4}-\d{2}-\d{2}\.ndjson$/;

export function getTelemetryLedgerDir(workspacePath: string): string {
  return path.join(workspacePath, ".msgcode", "telemetry");
}

export function getTelemetryLedgerPath(workspacePath: string, date: string | Date = new Date()): string {
  return path.join(getTelemetryLedgerDir(workspacePath), `telemetry-${formatLedgerDate(date)}.ndjson`);
}

export function appendTelemetryLedgerEntry(
  workspacePath: string,
  entry: TelemetryLedgerEntry,
  options?: { retentionDays?: number }
): string {
  const filePath = getTelemetryLedgerPath(workspacePath, entry.ts);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(normalizeEntry(entry))}\n`, "utf8");
  pruneTelemetryLedger(workspacePath, options);
  return filePath;
}

export function pruneTelemetryLedger(
  workspacePath: string,
  options?: { retentionDays?: number }
): void {
  const ledgerDir = getTelemetryLedgerDir(workspacePath);
  if (!fs.existsSync(ledgerDir)) {
    return;
  }

  const retentionDays = Math.max(1, options?.retentionDays ?? DEFAULT_RETENTION_DAYS);
  const files = fs.readdirSync(ledgerDir)
    .filter((name) => LEDGER_FILE_RE.test(name))
    .sort()
    .reverse();

  for (const fileName of files.slice(retentionDays)) {
    try {
      fs.unlinkSync(path.join(ledgerDir, fileName));
    } catch {
      // best-effort prune
    }
  }
}

function formatLedgerDate(input: string | Date): string {
  const date = input instanceof Date ? input : new Date(String(input));
  if (Number.isNaN(date.getTime())) {
    throw new Error("telemetry ledger date 非法");
  }
  return date.toISOString().slice(0, 10);
}

function normalizeEntry(entry: TelemetryLedgerEntry): TelemetryLedgerEntry {
  const normalized: TelemetryLedgerEntry = {
    ts: new Date(entry.ts).toISOString(),
    kind: entry.kind,
    source: sanitizeShortString(entry.source, "telemetry ledger source 不能为空"),
    name: sanitizeShortString(entry.name, "telemetry ledger name 不能为空"),
    ok: Boolean(entry.ok),
    durationMs: normalizeNonNegativeInteger(entry.durationMs),
    count: normalizeOptionalInteger(entry.count) ?? 1,
  };

  if (entry.workspace) normalized.workspace = sanitizeShortString(entry.workspace, "telemetry ledger workspace 非法", 240);
  if (entry.errorCode) normalized.errorCode = sanitizeShortString(entry.errorCode, "telemetry ledger errorCode 非法");
  if (entry.tokensIn !== undefined) normalized.tokensIn = normalizeOptionalInteger(entry.tokensIn);
  if (entry.tokensOut !== undefined) normalized.tokensOut = normalizeOptionalInteger(entry.tokensOut);
  if (entry.totalTokens !== undefined) normalized.totalTokens = normalizeOptionalInteger(entry.totalTokens);

  return normalized;
}

function sanitizeShortString(value: string, message: string, maxLength: number = 120): string {
  const normalized = String(value)
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    throw new Error(message);
  }
  return normalized.slice(0, maxLength);
}

function normalizeNonNegativeInteger(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.round(value);
}

function normalizeOptionalInteger(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  return normalizeNonNegativeInteger(value);
}
