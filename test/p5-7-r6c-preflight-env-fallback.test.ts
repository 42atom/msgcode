/**
 * P5.7-R6c: preflight 环境变量兜底回归锁
 *
 * 目标：
 * - 未手工 source 时，pathEnv 依赖可从 ~/.config/msgcode/.env 自动读取
 * - 配置文件兜底值回写到 process.env，供后续检查复用
 */

import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runPreflight } from "../src/deps/preflight.js";
import type { DependencyManifest } from "../src/deps/types.js";

describe("P5.7-R6c: preflight env fallback", () => {
  it("FEISHU_APP_ID 未注入进程环境时应从 ~/.config/msgcode/.env 兜底读取", async () => {
    const oldHome = process.env.HOME;
    const oldAppId = process.env.FEISHU_APP_ID;

    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "msgcode-preflight-home-"));
    const confDir = path.join(tempHome, ".config", "msgcode");
    fs.mkdirSync(confDir, { recursive: true });
    fs.writeFileSync(
      path.join(confDir, ".env"),
      "FEISHU_APP_ID=cli_test\n",
      "utf-8",
    );

    const manifest: DependencyManifest = {
      version: 1,
      requiredForStart: [
        {
          id: "feishu_app_id",
          kind: "env_set",
          pathEnv: "FEISHU_APP_ID",
          requiredForStart: true,
        },
      ],
      requiredForJobs: [],
      optional: [],
    };

    try {
      process.env.HOME = tempHome;
      delete process.env.FEISHU_APP_ID;

      const result = await runPreflight(manifest);
      const appId = result.requiredForStart[0];

      expect(appId.available).toBe(true);
      expect(appId.details).toEqual({
        env: "FEISHU_APP_ID",
        source: "config-file",
      });
      expect(process.env.FEISHU_APP_ID).toBe("cli_test");
    } finally {
      if (oldHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = oldHome;
      }

      if (oldAppId === undefined) {
        delete process.env.FEISHU_APP_ID;
      } else {
        process.env.FEISHU_APP_ID = oldAppId;
      }

      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });
});
