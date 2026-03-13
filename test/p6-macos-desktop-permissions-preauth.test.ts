import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("macOS desktop permissions preauth (thin, best-effort)", () => {
  test("应该只在 launchd daemon 或 force 时启用（其它情况直接跳过）", async () => {
    const mod = await import("../src/runtime/desktop-permissions-preauth.js");

    const original = { ...process.env };
    try {
      process.env.MSGCODE_DESKTOP_PREAUTH = "1";
      delete process.env.MSGCODE_DAEMON_SUPERVISOR;
      delete process.env.MSGCODE_DESKTOP_PREAUTH_FORCE;

      const before = snapshotMarker();
      await mod.maybeRequestDesktopPermissionsPreauth();
      const after = snapshotMarker();

      // 在非 launchd/非 force 的情况下，应该不写 marker
      expect(after.exists).toBe(before.exists);
    } finally {
      process.env = original;
    }
  });
});

function snapshotMarker(): { path: string; exists: boolean } {
  const configDir = process.env.MSGCODE_CONFIG_DIR ?? path.join(os.homedir(), ".config", "msgcode");
  const markerPath = path.join(configDir, "flags", "desktop-permissions-preauth.v1.json");
  return {
    path: markerPath,
    exists: fs.existsSync(markerPath),
  };
}

