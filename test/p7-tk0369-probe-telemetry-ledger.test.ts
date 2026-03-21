import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getTelemetryLedgerPath } from "../src/runtime/telemetry-ledger.js";

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function readTelemetryLedgerEntries(ledgerPath: string): Array<Record<string, unknown>> {
  return fs.readFileSync(ledgerPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function mockProbeModules(): void {
  const createProbe = (name: string) => async () => ({
    name,
    status: "pass" as const,
    message: `${name} ok`,
  });

  mock.module("../src/probe/probes/index.js", () => ({
    probeEnvironment: createProbe("environment"),
    probePermissions: createProbe("permissions"),
    probeDaemon: createProbe("daemon"),
    probeConfig: createProbe("config"),
    probeRoutes: createProbe("routes"),
    probeConnections: createProbe("connections"),
    probeResources: createProbe("resources"),
  }));

  mock.module("../src/probe/probes/jobs.js", () => ({
    probeJobs: createProbe("jobs"),
  }));

  mock.module("../src/probe/probes/deps.js", () => ({
    probeDeps: createProbe("deps"),
  }));

  mock.module("../src/probe/probes/runner.js", () => ({
    probeCodex: createProbe("runner"),
  }));

  mock.module("../src/probe/probes/tts.js", () => ({
    probeTts: createProbe("tts"),
  }));

  mock.module("../src/probe/probes/inbound.js", () => ({
    probeInbound: createProbe("inbound"),
  }));
}

describe("tk0369: probe telemetry ledger writer slice", () => {
  let tempWorkspace = "";
  let originalCwd = "";

  beforeEach(() => {
    tempWorkspace = createTempDir("msgcode-probe-workspace-");
    originalCwd = process.cwd();
    process.chdir(tempWorkspace);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    mock.restore();
    fs.rmSync(tempWorkspace, { recursive: true, force: true });
  });

  it("runAllProbes 应追加一条 probe summary", async () => {
    mockProbeModules();
    const { runAllProbes } = await import("../src/probe/index.js");

    const report = await runAllProbes();

    expect(report.summary.status).toBe("pass");
    const ledgerPath = getTelemetryLedgerPath(tempWorkspace);
    expect(fs.existsSync(ledgerPath)).toBe(true);
    const entries = readTelemetryLedgerEntries(ledgerPath);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.kind).toBe("probe");
    expect(entries[0]?.source).toBe("probe-index");
    expect(entries[0]?.name).toBe("all");
    expect(entries[0]?.ok).toBe(true);
    expect(entries[0]?.count).toBe(12);
  });

  it("runSingleProbe 应追加一条单类 probe summary", async () => {
    mockProbeModules();
    const { runSingleProbe } = await import("../src/probe/index.js");

    const report = await runSingleProbe("routes");

    expect(report.summary.status).toBe("pass");
    const ledgerPath = getTelemetryLedgerPath(tempWorkspace);
    expect(fs.existsSync(ledgerPath)).toBe(true);
    const entries = readTelemetryLedgerEntries(ledgerPath);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.kind).toBe("probe");
    expect(entries[0]?.source).toBe("probe-index");
    expect(entries[0]?.name).toBe("routes");
    expect(entries[0]?.ok).toBe(true);
    expect(entries[0]?.count).toBe(1);
  });
});
