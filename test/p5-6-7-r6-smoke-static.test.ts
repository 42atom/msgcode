import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const WORKSPACES = [
  "/Users/admin/msgcode-workspaces/medicpass",
  "/Users/admin/msgcode-workspaces/charai",
  "/Users/admin/msgcode-workspaces/game01",
];

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeActiveRoute(routePath: string, chatGuid: string, workspacePath: string): void {
  fs.mkdirSync(path.dirname(routePath), { recursive: true });
  fs.writeFileSync(
    routePath,
    JSON.stringify(
      {
        version: 1,
        routes: {
          [chatGuid]: {
            chatGuid,
            workspacePath,
            botType: "default",
            status: "active",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        },
      },
      null,
      2
    ),
    "utf-8"
  );
}

describe("P5.6.7-R6: 集成冒烟行为验证", () => {
  let tmpDir = "";
  let routesPath = "";
  let jobsPath = "";
  let runsPath = "";
  let originalRoutesPath: string | undefined;
  let originalJobsPath: string | undefined;
  let originalRunsPath: string | undefined;

  beforeEach(() => {
    tmpDir = createTempDir("msgcode-smoke-static-");
    routesPath = path.join(tmpDir, "routes.json");
    jobsPath = path.join(tmpDir, "cron", "jobs.json");
    runsPath = path.join(tmpDir, "cron", "runs.jsonl");

    originalRoutesPath = process.env.ROUTES_FILE_PATH;
    originalJobsPath = process.env.JOBS_FILE_PATH;
    originalRunsPath = process.env.RUNS_FILE_PATH;

    process.env.ROUTES_FILE_PATH = routesPath;
    process.env.JOBS_FILE_PATH = jobsPath;
    process.env.RUNS_FILE_PATH = runsPath;
  });

  afterEach(() => {
    if (originalRoutesPath === undefined) {
      delete process.env.ROUTES_FILE_PATH;
    } else {
      process.env.ROUTES_FILE_PATH = originalRoutesPath;
    }
    if (originalJobsPath === undefined) {
      delete process.env.JOBS_FILE_PATH;
    } else {
      process.env.JOBS_FILE_PATH = originalJobsPath;
    }
    if (originalRunsPath === undefined) {
      delete process.env.RUNS_FILE_PATH;
    } else {
      process.env.RUNS_FILE_PATH = originalRunsPath;
    }

    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe("工作区配置检查", () => {
    for (const ws of WORKSPACES) {
      const name = path.basename(ws);
      it(`${name}: .msgcode/config.json 存在`, () => {
        const configPath = path.join(ws, ".msgcode", "config.json");
        expect(fs.existsSync(configPath)).toBe(true);
      });
    }
  });

  describe("关键语义验证", () => {
    it("clearSessionArtifacts 应清理 window + summary，但不碰其他工作区文件", async () => {
      const workspacePath = path.join(tmpDir, "workspace-clear");
      fs.mkdirSync(workspacePath, { recursive: true });
      fs.mkdirSync(path.join(workspacePath, "AIDOCS"), { recursive: true });
      fs.writeFileSync(path.join(workspacePath, "AIDOCS", "keep.txt"), "keep", "utf-8");

      const { appendWindow, loadWindow } = await import("../src/session-window.js");
      const { saveSummary, loadSummary } = await import("../src/summary.js");
      const { clearSessionArtifacts } = await import("../src/session-artifacts.js");

      await appendWindow(workspacePath, "chat-smoke-clear", {
        role: "user",
        content: "上一轮上下文",
      });
      await saveSummary(workspacePath, "chat-smoke-clear", {
        goal: ["保留这轮目标"],
        constraints: [],
        decisions: [],
        openItems: [],
        toolFacts: [],
      });

      const result = await clearSessionArtifacts(workspacePath, "chat-smoke-clear");

      expect(result).toEqual({ ok: true });
      expect(await loadWindow(workspacePath, "chat-smoke-clear")).toEqual([]);
      expect(await loadSummary(workspacePath, "chat-smoke-clear")).toEqual({
        goal: [],
        constraints: [],
        decisions: [],
        openItems: [],
        toolFacts: [],
      });
      expect(fs.readFileSync(path.join(workspacePath, "AIDOCS", "keep.txt"), "utf-8")).toBe("keep");
    });

    it("handleReloadCommand 应返回 schedule 与 SOUL 的真实观测字段", async () => {
      const workspacePath = path.join(tmpDir, "workspace-reload");
      fs.mkdirSync(path.join(workspacePath, ".msgcode", "schedules"), { recursive: true });
      fs.writeFileSync(
        path.join(workspacePath, ".msgcode", "SOUL.md"),
        "# Workspace SOUL\n\n来自工作区的 SOUL。",
        "utf-8"
      );
      writeActiveRoute(routesPath, "chat-smoke-reload", workspacePath);

      const { handleReloadCommand } = await import("../src/routes/cmd-schedule.ts");
      const result = await handleReloadCommand({
        chatId: "chat-smoke-reload",
        args: [],
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain("Schedules:");
      expect(result.message).toContain("Scheduler Refresh:");
      expect(result.message).toContain("SOUL: source=workspace");
      expect(result.message).toContain("SOUL Entries:");
      expect(result.message).toContain(`Workspace SOUL: yes (${path.join(workspacePath, ".msgcode", "SOUL.md")})`);
    });

    it("skills/auto.ts 的 runSkill 应返回 retired compat 提示", async () => {
      const { runSkill } = await import("../src/skills/auto.js");

      const result = await runSkill("system-info", "system info", {
        chatId: "chat-smoke-skill",
        workspacePath: "/tmp/msgcode-smoke-skill",
      });

      expect(result.ok).toBe(false);
      expect(result.skillId).toBe("retired-auto-skill");
      expect(result.error).toContain("auto skill 已退役");
      expect(result.error).toContain("printenv");
    });
  });

  describe("回归锁一致性", () => {
    it("P5.6.2-R1 回归锁存在", () => {
      const testPath = path.join(process.cwd(), "test/p5-6-2-r1-regression.test.ts");
      expect(fs.existsSync(testPath)).toBe(true);
    });

    it("P5.6.4 回归锁存在", () => {
      const testPath = path.join(process.cwd(), "test/p5-6-4-state-boundary.test.ts");
      expect(fs.existsSync(testPath)).toBe(true);
    });
  });
});
