import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { getSchedule } from "../src/runtime/schedule-wake.js";
import {
  convertScheduleV1ToV2,
  getScheduleV1BackupPath,
  migrateWorkspaceSchedulesV1ToV2,
  readScheduleVersion,
  rollbackWorkspaceSchedulesFromV1Backups,
} from "../src/runtime/schedule-migration.js";
import { createScheduleCommand, getScheduleMigrateV1ToV2Contract } from "../src/cli/schedule.js";

function createTempWorkspace(): string {
  const root = path.join(tmpdir(), `msgcode-schedule-migration-${randomUUID()}`);
  fs.mkdirSync(path.join(root, ".msgcode", "schedules"), { recursive: true });
  return root;
}

function cleanupTempWorkspace(root: string): void {
  if (fs.existsSync(root)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function writeScheduleFile(workspacePath: string, scheduleId: string, payload: object): string {
  const schedulePath = path.join(workspacePath, ".msgcode", "schedules", `${scheduleId}.json`);
  fs.writeFileSync(schedulePath, JSON.stringify(payload, null, 2), "utf8");
  return schedulePath;
}

describe("tk0210: schedule v1 -> v2 workspace migration", () => {
  let workspace: string;

  beforeEach(() => {
    workspace = createTempWorkspace();
  });

  afterEach(() => {
    cleanupTempWorkspace(workspace);
  });

  it("M1: v1 映射到 v2 时保留时间语义与 hint", () => {
    const converted = convertScheduleV1ToV2(
      {
        version: 1,
        enabled: true,
        tz: "Asia/Shanghai",
        cron: "0 9 * * 1-5",
        message: "工作日提醒",
        delivery: {
          mode: "reply-to-same-chat",
          maxChars: 2000,
        },
      },
      1700000000000
    );

    expect(converted.version).toBe(2);
    expect(converted.enabled).toBe(true);
    expect(converted.schedule).toEqual({
      kind: "cron",
      expr: "0 9 * * 1-5",
      tz: "Asia/Shanghai",
    });
    expect(converted.wake).toEqual({
      mode: "next-heartbeat",
      hint: "工作日提醒",
      latePolicy: "run-if-missed",
    });
    expect(converted.createdAt).toBe(1700000000000);
    expect(converted.updatedAt).toBe(1700000000000);
  });

  it("M2: 迁移 v1 文件会创建备份，原文件改成 v2，并可被 schedule-wake 读取", async () => {
    writeScheduleFile(workspace, "morning", {
      version: 1,
      enabled: true,
      tz: "Asia/Shanghai",
      cron: "0 9 * * *",
      message: "早上九点提醒",
      delivery: {
        mode: "reply-to-same-chat",
        maxChars: 2000,
      },
    });

    const result = await migrateWorkspaceSchedulesV1ToV2({
      workspacePath: workspace,
      nowMs: 1700000000000,
    });

    expect(result.failures).toEqual([]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.status).toBe("migrated");

    const backupPath = getScheduleV1BackupPath(workspace, "morning");
    expect(fs.existsSync(backupPath)).toBe(true);
    expect(await readScheduleVersion(workspace, "morning")).toBe(2);

    const migrated = getSchedule(workspace, "morning");
    expect(migrated).not.toBeNull();
    expect(migrated?.schedule).toEqual({
      kind: "cron",
      expr: "0 9 * * *",
      tz: "Asia/Shanghai",
    });
    expect(migrated?.wake.hint).toBe("早上九点提醒");

    expect(fs.existsSync(path.join(workspace, ".msgcode", "wakeups"))).toBe(false);
  });

  it("M3: delivery 缺失时仍按默认规则迁移", async () => {
    writeScheduleFile(workspace, "no-delivery", {
      version: 1,
      enabled: false,
      tz: "UTC",
      cron: "*/15 * * * *",
      message: "每 15 分钟检查一次",
    });

    const result = await migrateWorkspaceSchedulesV1ToV2({
      workspacePath: workspace,
      scheduleId: "no-delivery",
      nowMs: 1700000000000,
    });

    expect(result.failures).toEqual([]);
    const migrated = getSchedule(workspace, "no-delivery");
    expect(migrated?.enabled).toBe(false);
    expect(migrated?.wake.mode).toBe("next-heartbeat");
    expect(migrated?.wake.latePolicy).toBe("run-if-missed");
    expect(migrated?.wake.hint).toBe("每 15 分钟检查一次");
  });

  it("M4: 不合法旧文件不会写坏现有 schedule", async () => {
    const schedulePath = writeScheduleFile(workspace, "broken", {
      version: 1,
      enabled: true,
      tz: "Asia/Shanghai",
      cron: "0 9 * * *",
      message: "",
    });
    const before = fs.readFileSync(schedulePath, "utf8");

    const result = await migrateWorkspaceSchedulesV1ToV2({
      workspacePath: workspace,
      scheduleId: "broken",
    });

    expect(result.items).toEqual([]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.scheduleId).toBe("broken");
    expect(fs.readFileSync(schedulePath, "utf8")).toBe(before);
    expect(fs.existsSync(getScheduleV1BackupPath(workspace, "broken"))).toBe(false);
  });

  it("M5: rollback 会从 v1 备份恢复原文件", async () => {
    writeScheduleFile(workspace, "rollback-me", {
      version: 1,
      enabled: true,
      tz: "Asia/Singapore",
      cron: "30 8 * * *",
      message: "回滚测试",
      delivery: {
        mode: "reply-to-same-chat",
        maxChars: 512,
      },
    });

    await migrateWorkspaceSchedulesV1ToV2({
      workspacePath: workspace,
      scheduleId: "rollback-me",
      nowMs: 1700000000000,
    });

    const rollback = await rollbackWorkspaceSchedulesFromV1Backups({
      workspacePath: workspace,
      scheduleId: "rollback-me",
    });

    expect(rollback.failures).toEqual([]);
    expect(rollback.items).toHaveLength(1);
    expect(rollback.items[0]?.status).toBe("restored");
    expect(await readScheduleVersion(workspace, "rollback-me")).toBe(1);

    const restored = JSON.parse(
      fs.readFileSync(path.join(workspace, ".msgcode", "schedules", "rollback-me.json"), "utf8")
    ) as { message?: string; delivery?: { maxChars?: number } };
    expect(restored.message).toBe("回滚测试");
    expect(restored.delivery?.maxChars).toBe(512);
  });

  it("M6: schedule 命令面公开 migrate-v1-to-v2", () => {
    const cmd = createScheduleCommand();
    const subCommands = cmd.commands.map((item) => item.name());
    expect(subCommands).toContain("migrate-v1-to-v2");

    const contract = getScheduleMigrateV1ToV2Contract();
    expect(contract.name).toBe("msgcode schedule migrate-v1-to-v2");
    expect(contract.errorCodes).toContain("SCHEDULE_MIGRATION_FAILED");
  });
});
