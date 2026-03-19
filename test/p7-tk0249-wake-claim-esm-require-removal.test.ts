import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { getClaimsDir } from "../src/runtime/wake-store.js";

function createTempWorkspace(): string {
  const root = path.join(tmpdir(), `msgcode-wake-esm-${randomUUID()}`);
  fs.mkdirSync(root, { recursive: true });
  return root;
}

describe("tk0249: wake claim esm require removal", () => {
  it("getStaleClaims 在 node esm 下不应再报 require is not defined", () => {
    const workspace = createTempWorkspace();
    const claimsDir = getClaimsDir(workspace);
    fs.mkdirSync(claimsDir, { recursive: true });
    fs.writeFileSync(
      path.join(claimsDir, "wake-1.claim"),
      JSON.stringify({
        wakeId: "wake-1",
        owner: "dead-consumer",
        claimedAt: Date.now() - 400000,
        leaseUntil: Date.now() - 300000,
        safetyMarginSec: 10,
      }, null, 2),
      "utf8",
    );

    const script = `
      import { getStaleClaims } from ${JSON.stringify(path.join(process.cwd(), "src/runtime/wake-claim.ts"))};
      const claims = getStaleClaims(${JSON.stringify(workspace)});
      console.log(JSON.stringify({ count: claims.length, wakeId: claims[0]?.wakeId || null }));
    `;

    try {
      const result = spawnSync(
        "node",
        ["--import", "tsx", "--input-type=module", "--eval", script],
        {
          cwd: process.cwd(),
          encoding: "utf8",
        },
      );

      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout.trim()) as { count: number; wakeId: string | null };
      expect(parsed).toEqual({ count: 1, wakeId: "wake-1" });
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });
});
