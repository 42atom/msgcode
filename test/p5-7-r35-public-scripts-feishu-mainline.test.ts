import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("P5.7-R35: public scripts should hit feishu mainline", () => {
  for (const scriptName of ["dev", "start"] as const) {
    it(`npm run ${scriptName} 应命中当前 CLI 主链，而不是旧 index.ts/imsg 壳`, () => {
      const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), `msgcode-${scriptName}-home-`));

      try {
        const env = {
          ...process.env,
          HOME: tempHome,
          MY_EMAIL: "user@example.com",
          WORKSPACE_ROOT: path.join(tempHome, "workspaces"),
          LOG_FILE: "false",
          MSGCODE_ENV_BOOTSTRAPPED: "1",
        };
        delete env.FEISHU_APP_ID;
        delete env.FEISHU_APP_SECRET;
        delete env.FEISHU_ENCRYPT_KEY;
        delete env.MSGCODE_TRANSPORTS;
        delete env.IMSG_PATH;

        const result = spawnSync("npm", ["run", scriptName], {
          cwd: "/Users/admin/GitProjects/msgcode",
          env,
          encoding: "utf-8",
          timeout: 3000,
          killSignal: "SIGINT",
        });

        const output = `${result.stdout}\n${result.stderr}`;

        expect(output).not.toContain("index.ts 入口仅支持 imsg");
        expect(output).not.toContain("tsx src/index.ts");
        expect(output).toContain("tsx src/cli.ts start debug");
        expect(output).toMatch(/Feishu transport 已启用|msgcode 已启动（transports: feishu）|FEISHU_APP_ID \/ FEISHU_APP_SECRET/);
      } finally {
        fs.rmSync(tempHome, { recursive: true, force: true });
      }
    });
  }
});
