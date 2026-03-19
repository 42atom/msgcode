import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { consumePendingWakes } from "../src/runtime/wake-heartbeat.js";
import { createWakeRecord, getWakeRecord, getClaimsDir } from "../src/runtime/wake-store.js";

function createTempWorkspace(): string {
  const root = path.join(tmpdir(), `msgcode-wake-vitals-${randomUUID()}`);
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.join(root, "issues"), { recursive: true });
  return root;
}

function writeTaskDoc(workspace: string, fileName: string, risk = "low"): void {
  const content = `---
owner: agent
assignee: codex
reviewer: user
why: test
scope: test
risk: ${risk}
accept: test
implicit:
  waiting_for: ""
  next_check: ""
  stale_since: ""
---

# Task
`;
  fs.writeFileSync(path.join(workspace, "issues", fileName), content, "utf8");
}

describe("tk0241: wake vitals policy defer and degrade", () => {
  let workspace: string;

  beforeEach(() => {
    workspace = createTempWorkspace();
  });

  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it("load/stall 高时应 defer，并保持 wake record 不变", async () => {
    writeTaskDoc(workspace, "tk5001.bkd.runtime.blocked-a.md");
    writeTaskDoc(workspace, "tk5002.bkd.runtime.blocked-b.md");
    writeTaskDoc(workspace, "tk5003.bkd.runtime.blocked-c.md");
    writeTaskDoc(workspace, "tk5004.bkd.runtime.blocked-d.md");

    const record = createWakeRecord(workspace, {
      id: randomUUID(),
      status: "pending",
      path: "run",
      hint: "稍后再试",
      latePolicy: "run-if-missed",
    }, Date.now() - 1000);

    const results = await consumePendingWakes(workspace, async () => {});

    expect(results).toHaveLength(1);
    expect(results[0]?.consumed).toBe(false);
    expect(results[0]?.error).toContain("deferred by vitals");
    expect(getWakeRecord(workspace, record.id)?.status).toBe("pending");
    expect(fs.existsSync(path.join(getClaimsDir(workspace), `${record.id}.claim`))).toBe(false);
  });

  it("risk/headroom 进入 degrade 时只放行轻路径 wake", async () => {
    writeTaskDoc(workspace, "tk5100.tdo.runtime.high-risk-a.md", "high");
    writeTaskDoc(workspace, "tk5101.tdo.runtime.high-risk-b.md", "high");
    writeTaskDoc(workspace, "tk5102.tdo.runtime.high-risk-c.md", "high");
    writeTaskDoc(workspace, "tk5103.tdo.runtime.high-risk-d.md", "high");

    const heavy = createWakeRecord(workspace, {
      id: randomUUID(),
      status: "pending",
      path: "task",
      taskId: "tk5100",
      hint: "重路径 wake",
      latePolicy: "run-if-missed",
    }, Date.now() - 2000);

    const light = createWakeRecord(workspace, {
      id: randomUUID(),
      status: "pending",
      path: "run",
      hint: "轻路径 wake",
      latePolicy: "run-if-missed",
    }, Date.now() - 1000);

    const seen: string[] = [];
    const results = await consumePendingWakes(workspace, async ({ wakeRecord }) => {
      seen.push(wakeRecord.id);
    });

    const heavyResult = results.find((item) => item.wakeRecordId === heavy.id);
    const lightResult = results.find((item) => item.wakeRecordId === light.id);

    expect(heavyResult?.consumed).toBe(false);
    expect(heavyResult?.error).toContain("degraded by vitals");
    expect(lightResult?.consumed).toBe(true);
    expect(seen).toEqual([light.id]);
    expect(getWakeRecord(workspace, heavy.id)?.status).toBe("pending");
    expect(getWakeRecord(workspace, light.id)?.status).toBe("done");
  });
});
