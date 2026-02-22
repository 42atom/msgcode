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
  it("IMSG_PATH 未注入进程环境时应从 ~/.config/msgcode/.env 兜底读取", async () => {
    const oldHome = process.env.HOME;
    const oldImsg = process.env.IMSG_PATH;

    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "msgcode-preflight-home-"));
    const confDir = path.join(tempHome, ".config", "msgcode");
    fs.mkdirSync(confDir, { recursive: true });
    fs.writeFileSync(
      path.join(confDir, ".env"),
      "IMSG_PATH=/bin/echo\n",
      "utf-8",
    );

    const manifest: DependencyManifest = {
      version: 1,
      requiredForStart: [
        {
          id: "imsg",
          kind: "bin",
          pathEnv: "IMSG_PATH",
          requiredForStart: true,
        },
      ],
      requiredForJobs: [],
      optional: [],
    };

    try {
      process.env.HOME = tempHome;
      delete process.env.IMSG_PATH;

      const result = await runPreflight(manifest);
      const imsg = result.requiredForStart[0];

      expect(imsg.available).toBe(true);
      expect(imsg.details && typeof imsg.details === "object" ? (imsg.details as { path?: string }).path : undefined).toBe("/bin/echo");
      expect(process.env.IMSG_PATH).toBe("/bin/echo");
    } finally {
      if (oldHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = oldHome;
      }

      if (oldImsg === undefined) {
        delete process.env.IMSG_PATH;
      } else {
        process.env.IMSG_PATH = oldImsg;
      }

      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });
});

