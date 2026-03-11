#!/usr/bin/env node
/**
 * Memory E2E recall smoke
 *
 * 用法:
 *   npm run memory:e2e
 *   npm run memory:e2e -- --workspace /abs/path/to/workspace
 */

import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";

interface Envelope {
  status: "pass" | "warning" | "error";
  errors?: Array<{ code?: string; message?: string }>;
  data?: {
    count?: number;
  };
}

function getWorkspaceArg(argv: string[]): string | undefined {
  const idx = argv.findIndex((arg) => arg === "--workspace");
  if (idx >= 0 && argv[idx + 1]) {
    return argv[idx + 1];
  }
  return undefined;
}

function runCli(args: string[]): Envelope {
  const result = spawnSync("npx", ["tsx", "src/cli.ts", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, LOG_FILE: "false", LOG_LEVEL: "warn" },
  });

  if ((result.status ?? 1) !== 0) {
    const output = (result.stdout || result.stderr || "").trim();
    throw new Error(`CLI failed (${args.join(" ")}): ${output}`);
  }

  const stdout = (result.stdout || "").trim();
  if (!stdout) {
    throw new Error(`CLI returned empty output (${args.join(" ")})`);
  }

  return JSON.parse(stdout) as Envelope;
}

function main(): void {
  const workspaceArg = getWorkspaceArg(process.argv.slice(2));
  const managedWorkspace = !workspaceArg;
  const workspacePath = workspaceArg || mkdtempSync(path.join(os.tmpdir(), "msgcode-memory-e2e-"));

  try {
    const marker = `memorye2e${Date.now()}`;

    runCli(["memory", "add", marker, "--workspace", workspacePath, "--json"]);
    runCli(["memory", "index", "--workspace", workspacePath, "--json"]);
    const search = runCli(["memory", "search", marker, "--workspace", workspacePath, "--json"]);

    const count = Number(search.data?.count || 0);
    if (count < 1) {
      throw new Error(`recall failed: expected >=1, got ${count}`);
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          workspacePath,
          query: marker,
          resultCount: count,
        },
        null,
        2
      )
    );
  } finally {
    if (managedWorkspace) {
      rmSync(workspacePath, { recursive: true, force: true });
    }
  }
}

main();
