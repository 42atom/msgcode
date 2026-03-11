import { describe, it, expect } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

describe("P5.7-R19: scheduler refresh 日志隔离", () => {
  it("bun test 中的 scheduler 不会再写正式文件日志", async () => {
    const tmpRoot = await mkdtemp(path.join(tmpdir(), "msgcode-scheduler-log-isolation-"));
    const childSpecPath = path.join(tmpRoot, "child-scheduler.test.ts");
    const childLogPath = path.join(tmpRoot, "child-msgcode.log");
    const childJobsPath = path.join(tmpRoot, "jobs.json");
    const childRunsPath = path.join(tmpRoot, "runs.jsonl");

    await writeFile(
      childSpecPath,
      [
        "import { test, expect } from \"bun:test\";",
        "import { JobScheduler } from \"/Users/admin/GitProjects/msgcode/src/jobs/scheduler.ts\";",
        "",
        "test(\"scheduler child log isolation\", async () => {",
        "  const scheduler = new JobScheduler({",
        "    getRouteFn: () => null,",
        "    executeJobFn: async () => ({ status: \"ok\", durationMs: 1 }),",
        "  });",
        "  await scheduler.start();",
        "  scheduler.stop();",
        "  expect(true).toBe(true);",
        "});",
        "",
      ].join("\n"),
      "utf-8"
    );

    try {
      const result = spawnSync(process.execPath, ["test", childSpecPath], {
        cwd: "/Users/admin/GitProjects/msgcode",
        env: {
          ...process.env,
          LOG_CONSOLE: "false",
          LOG_PATH: childLogPath,
          JOBS_FILE_PATH: childJobsPath,
          RUNS_FILE_PATH: childRunsPath,
        },
        encoding: "utf-8",
      });

      expect(result.status).toBe(0);
      expect(existsSync(childLogPath)).toBe(false);
    } finally {
      await rm(tmpRoot, { recursive: true, force: true });
    }
  });
});
