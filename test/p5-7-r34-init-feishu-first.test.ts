import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("P5.7-R34: init feishu-first onboarding", () => {
  it("msgcode init 应创建 feishu-first 的默认配置与输出", () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "msgcode-init-home-"));
    const tempCwd = fs.mkdtempSync(path.join(os.tmpdir(), "msgcode-init-cwd-"));

    try {
      const result = spawnSync("node", ["bin/msgcode", "init"], {
        cwd: "/Users/admin/GitProjects/msgcode",
        env: {
          ...process.env,
          HOME: tempHome,
        },
        encoding: "utf-8",
      });

      expect(result.status).toBe(0);

      const stdout = result.stdout;
      expect(stdout).toContain("设置白名单 + FEISHU_APP_ID + FEISHU_APP_SECRET");
      expect(stdout).toContain("msgcode preflight");
      expect(stdout).toContain("把机器人拉进飞书群");
      expect(stdout).not.toContain("Messages 数据库");
      expect(stdout).not.toContain("Full Disk Access");
      expect(stdout).not.toContain("iMessage 手动建群");

      const envFile = path.join(tempHome, ".config", "msgcode", ".env");
      const envText = fs.readFileSync(envFile, "utf-8");

      expect(envText).toContain("FEISHU_APP_ID=");
      expect(envText).toContain("FEISHU_APP_SECRET=");
      expect(envText).not.toContain("IMSG_PATH");
      expect(envText).not.toContain("MSGCODE_TRANSPORTS=imsg");
    } finally {
      fs.rmSync(tempHome, { recursive: true, force: true });
      fs.rmSync(tempCwd, { recursive: true, force: true });
    }
  });
});
