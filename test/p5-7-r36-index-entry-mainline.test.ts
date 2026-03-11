import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("P5.7-R36: src/index.ts should be a thin mainline wrapper", () => {
  it("直接运行 src/index.ts 时应命中当前 startBot 主链，而不是旧 imsg-only 入口", () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "msgcode-index-home-"));

    try {
      const result = spawnSync("node", ["src/index.ts"], {
        cwd: "/Users/admin/GitProjects/msgcode",
        env: {
          ...process.env,
          HOME: tempHome,
          MY_EMAIL: "user@example.com",
          WORKSPACE_ROOT: path.join(tempHome, "workspaces"),
          LOG_FILE: "false",
          NODE_OPTIONS: "--import tsx",
        },
        encoding: "utf-8",
        timeout: 3000,
        killSignal: "SIGINT",
      });

      const output = `${result.stdout}\n${result.stderr}`;

      expect(output).not.toContain("index.ts 入口仅支持 imsg");
      expect(output).toMatch(/运行时托管 skills 已同步|JobScheduler 已启动|msgcode 已启动（transports:/);
    } finally {
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });
});
