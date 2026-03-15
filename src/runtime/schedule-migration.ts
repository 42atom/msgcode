import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { atomicWriteFile } from "./fs-atomic.js";
import { getSchedule, getSchedulePath, getSchedulesDir, type ScheduleFile as V2ScheduleFile } from "./schedule-wake.js";

export interface LegacyScheduleFileV1 {
  version: 1;
  enabled: boolean;
  tz: string;
  cron: string;
  message: string;
  delivery?: {
    mode?: "reply-to-same-chat";
    maxChars?: number;
  };
}

export interface ScheduleMigrationFailure {
  scheduleId: string;
  error: string;
}

export interface ScheduleMigrationItemResult {
  scheduleId: string;
  status: "migrated" | "skipped" | "restored";
  backupPath?: string;
  reason?: string;
}

export interface ScheduleMigrationBatchResult {
  workspacePath: string;
  items: ScheduleMigrationItemResult[];
  failures: ScheduleMigrationFailure[];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isLegacyScheduleV1(value: unknown): value is LegacyScheduleFileV1 {
  if (!value || typeof value !== "object") return false;
  const schedule = value as Partial<LegacyScheduleFileV1>;
  return (
    schedule.version === 1 &&
    typeof schedule.enabled === "boolean" &&
    isNonEmptyString(schedule.tz) &&
    isNonEmptyString(schedule.cron) &&
    isNonEmptyString(schedule.message)
  );
}

export function getScheduleV1BackupPath(workspacePath: string, scheduleId: string): string {
  return `${getSchedulePath(workspacePath, scheduleId)}.v1.bak`;
}

export function convertScheduleV1ToV2(schedule: LegacyScheduleFileV1, nowMs: number = Date.now()): V2ScheduleFile {
  return {
    version: 2,
    enabled: schedule.enabled,
    schedule: {
      kind: "cron",
      expr: schedule.cron,
      tz: schedule.tz,
    },
    wake: {
      mode: "next-heartbeat",
      hint: schedule.message,
      latePolicy: "run-if-missed",
    },
    createdAt: nowMs,
    updatedAt: nowMs,
  };
}

async function readScheduleJson(schedulePath: string): Promise<unknown> {
  const content = await readFile(schedulePath, "utf8");
  return JSON.parse(content) as unknown;
}

async function migrateSingleSchedule(workspacePath: string, scheduleId: string, nowMs: number): Promise<ScheduleMigrationItemResult> {
  const schedulePath = getSchedulePath(workspacePath, scheduleId);
  if (!existsSync(schedulePath)) {
    throw new Error(`schedule 不存在: ${scheduleId}`);
  }

  const rawContent = await readFile(schedulePath, "utf8");
  const rawSchedule = JSON.parse(rawContent) as unknown;

  if ((rawSchedule as { version?: unknown })?.version === 2) {
    return {
      scheduleId,
      status: "skipped",
      reason: "already-v2",
    };
  }

  if (!isLegacyScheduleV1(rawSchedule)) {
    throw new Error("旧 schedule 结构不合法，拒绝迁移");
  }

  const backupPath = getScheduleV1BackupPath(workspacePath, scheduleId);
  if (!existsSync(backupPath)) {
    await atomicWriteFile(backupPath, rawContent);
  }

  const migrated = convertScheduleV1ToV2(rawSchedule, nowMs);

  try {
    await atomicWriteFile(schedulePath, JSON.stringify(migrated, null, 2));
    const verified = getSchedule(workspacePath, scheduleId);
    if (!verified) {
      throw new Error("迁移后 schedule-wake 无法读取");
    }
  } catch (error) {
    await atomicWriteFile(schedulePath, rawContent);
    throw error;
  }

  return {
    scheduleId,
    status: "migrated",
    backupPath,
  };
}

function getScheduleIdFromBackupFile(fileName: string): string | null {
  if (!fileName.endsWith(".json.v1.bak")) {
    return null;
  }
  return fileName.slice(0, -".json.v1.bak".length);
}

async function restoreSingleSchedule(workspacePath: string, scheduleId: string): Promise<ScheduleMigrationItemResult> {
  const backupPath = getScheduleV1BackupPath(workspacePath, scheduleId);
  if (!existsSync(backupPath)) {
    throw new Error(`未找到回滚备份: ${scheduleId}`);
  }

  const backupContent = await readFile(backupPath, "utf8");
  const rawSchedule = JSON.parse(backupContent) as unknown;
  if (!isLegacyScheduleV1(rawSchedule)) {
    throw new Error("备份文件不是合法的 v1 schedule");
  }

  await atomicWriteFile(getSchedulePath(workspacePath, scheduleId), backupContent);

  return {
    scheduleId,
    status: "restored",
    backupPath,
  };
}

export async function migrateWorkspaceSchedulesV1ToV2(params: {
  workspacePath: string;
  scheduleId?: string;
  nowMs?: number;
}): Promise<ScheduleMigrationBatchResult> {
  const { workspacePath, scheduleId, nowMs = Date.now() } = params;
  const items: ScheduleMigrationItemResult[] = [];
  const failures: ScheduleMigrationFailure[] = [];
  const schedulesDir = getSchedulesDir(workspacePath);

  if (!existsSync(schedulesDir) && !scheduleId) {
    return { workspacePath, items, failures };
  }

  const scheduleIds = scheduleId
    ? [scheduleId]
    : (await readdir(schedulesDir))
        .filter((file) => file.endsWith(".json"))
        .map((file) => file.slice(0, -5))
        .sort();

  for (const currentScheduleId of scheduleIds) {
    try {
      items.push(await migrateSingleSchedule(workspacePath, currentScheduleId, nowMs));
    } catch (error) {
      failures.push({
        scheduleId: currentScheduleId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { workspacePath, items, failures };
}

export async function rollbackWorkspaceSchedulesFromV1Backups(params: {
  workspacePath: string;
  scheduleId?: string;
}): Promise<ScheduleMigrationBatchResult> {
  const { workspacePath, scheduleId } = params;
  const items: ScheduleMigrationItemResult[] = [];
  const failures: ScheduleMigrationFailure[] = [];
  const schedulesDir = getSchedulesDir(workspacePath);

  if (!existsSync(schedulesDir) && !scheduleId) {
    return { workspacePath, items, failures };
  }

  const scheduleIds = scheduleId
    ? [scheduleId]
    : (await readdir(schedulesDir))
        .map((file) => getScheduleIdFromBackupFile(file))
        .filter((value): value is string => Boolean(value))
        .sort();

  for (const currentScheduleId of scheduleIds) {
    try {
      items.push(await restoreSingleSchedule(workspacePath, currentScheduleId));
    } catch (error) {
      failures.push({
        scheduleId: currentScheduleId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { workspacePath, items, failures };
}

export async function readScheduleVersion(workspacePath: string, scheduleId: string): Promise<number | null> {
  const schedulePath = getSchedulePath(workspacePath, scheduleId);
  if (!existsSync(schedulePath)) {
    return null;
  }
  const raw = await readScheduleJson(schedulePath);
  const version = (raw as { version?: unknown })?.version;
  return typeof version === "number" ? version : null;
}
