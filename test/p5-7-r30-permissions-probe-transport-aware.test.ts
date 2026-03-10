import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PERMISSIONS_PROBE_URL = pathToFileURL(
  path.join(process.cwd(), "src/probe/probes/permissions.ts")
).href;

function runPermissionsProbe(
  overrides: Record<string, string | undefined>,
  setup?: (tempHome: string) => void
): { status: string; message: string; details: Record<string, unknown> } {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "msgcode-permissions-home-"));
  const tempCwd = fs.mkdtempSync(path.join(os.tmpdir(), "msgcode-permissions-cwd-"));

  try {
    const configDir = path.join(tempHome, ".config", "msgcode");
    const workspaceRoot = path.join(tempHome, "workspaces");
    fs.mkdirSync(configDir, { recursive: true });
    fs.mkdirSync(workspaceRoot, { recursive: true });
    setup?.(tempHome);

    const env = { ...process.env };
    delete env.MSGCODE_TRANSPORTS;
    delete env.FEISHU_APP_ID;
    delete env.FEISHU_APP_SECRET;
    delete env.IMSG_PATH;

    env.NODE_ENV = "test";
    env.HOME = tempHome;
    env.WORKSPACE_ROOT = workspaceRoot;

    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) {
        delete env[key];
      } else {
        env[key] = value;
      }
    }

    const script = `
      const { probePermissions } = await import(${JSON.stringify(PERMISSIONS_PROBE_URL)});
      const result = await probePermissions();
      console.log(JSON.stringify(result));
    `;
    const result = spawnSync(process.execPath, ["--eval", script], {
      cwd: tempCwd,
      env,
      encoding: "utf-8",
    });

    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || `child exit=${result.status}`);
    }

    return JSON.parse(result.stdout.trim());
  } finally {
    fs.rmSync(tempHome, { recursive: true, force: true });
    fs.rmSync(tempCwd, { recursive: true, force: true });
  }
}

describe("P5.7-R30: permissions probe transport-aware", () => {
  it("feishu-only 时，不应因缺失 Messages/chat.db 权限被打成 error", () => {
    const result = runPermissionsProbe({
      FEISHU_APP_ID: "cli_test",
      FEISHU_APP_SECRET: "secret_test",
    });

    expect(result.status).toBe("pass");
    expect(result.details.messages_readable).toBeNull();
    expect(result.details.full_disk_access).toBeNull();
  });

  it("imsg 启用时，仍应对 Messages/chat.db 权限保持严格检查", () => {
    const result = runPermissionsProbe({
      MSGCODE_TRANSPORTS: "imsg",
      IMSG_PATH: "/bin/echo",
    });

    expect(result.status).toBe("error");
    expect(String(result.message)).toContain("chat.db");
    expect(result.details.messages_readable).toBe(false);
    expect(result.details.full_disk_access).toBe(false);
  });
});
