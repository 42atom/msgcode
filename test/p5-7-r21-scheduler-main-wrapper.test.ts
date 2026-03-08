/**
 * msgcode: P5.7-R21 scheduler wrapper 参数归一化回归锁
 *
 * 目标：
 * - scheduler skill wrapper 接住 LLM 常见参数写法错误
 * - 不改 CLI 真相源，只在 skill 入口做最小归一化
 */

import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import path from "node:path";

const scriptPath = path.join(process.cwd(), "src", "skills", "runtime", "scheduler", "main.sh");

function runDry(args: string[]) {
  return spawnSync("bash", [scriptPath, ...args], {
    env: {
      ...process.env,
      MSGCODE_SCHEDULER_DRY_RUN: "1",
    },
    encoding: "utf-8",
  });
}

describe("P5.7-R21: scheduler wrapper 参数归一化", () => {
  it("add 缺少 --tz 时应透明补当前默认时区", () => {
    const result = spawnSync("bash", [scriptPath, "add", "live-cron", "--workspace", "/tmp/ws", "--cron", "*/1 * * * *", "--message", "live cron"], {
      env: {
        ...process.env,
        MSGCODE_SCHEDULER_DRY_RUN: "1",
        MSGCODE_SCHEDULER_DEFAULT_TZ: "Asia/Singapore",
      },
      encoding: "utf-8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout.trim().split("\n")).toEqual([
      "add",
      "live-cron",
      "--workspace",
      "/tmp/ws",
      "--cron",
      "*/1 * * * *",
      "--message",
      "live cron",
      "--tz",
      "Asia/Singapore",
    ]);
  });

  it("已显式给出 --tz 时不应重复追加默认时区", () => {
    const result = spawnSync("bash", [scriptPath, "add", "live-cron", "--workspace", "/tmp/ws", "--cron", "*/1 * * * *", "--tz", "Asia/Tokyo", "--message", "live cron"], {
      env: {
        ...process.env,
        MSGCODE_SCHEDULER_DRY_RUN: "1",
        MSGCODE_SCHEDULER_DEFAULT_TZ: "Asia/Singapore",
      },
      encoding: "utf-8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout.trim().split("\n")).toEqual([
      "add",
      "live-cron",
      "--workspace",
      "/tmp/ws",
      "--cron",
      "*/1 * * * *",
      "--tz",
      "Asia/Tokyo",
      "--message",
      "live cron",
    ]);
  });

  it("应把 --scheduleId 归一化成 add 的位置参数", () => {
    const result = runDry([
      "add",
      "--scheduleId",
      "live-cron",
      "--workspace",
      "/tmp/ws",
      "--cron",
      "*/1 * * * *",
      "--tz",
      "Asia/Singapore",
      "--message",
      "live cron",
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout.trim().split("\n")).toEqual([
      "add",
      "live-cron",
      "--workspace",
      "/tmp/ws",
      "--cron",
      "*/1 * * * *",
      "--tz",
      "Asia/Singapore",
      "--message",
      "live cron",
    ]);
  });

  it("应支持 remove 的 delete/stop 别名并保留位置参数", () => {
    const result = runDry([
      "delete",
      "--schedule-id",
      "live-cron",
      "--workspace",
      "/tmp/ws",
      "--json",
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout.trim().split("\n")).toEqual([
      "remove",
      "live-cron",
      "--workspace",
      "/tmp/ws",
      "--json",
    ]);
  });

  it("在缺少 schedule-id 时应明确报错", () => {
    const result = runDry([
      "add",
      "--workspace",
      "/tmp/ws",
      "--cron",
      "*/1 * * * *",
      "--tz",
      "Asia/Singapore",
      "--message",
      "live cron",
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("missing required positional argument");
  });
});
