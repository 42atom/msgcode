/**
 * msgcode: Codex JSONL reader/parser tests
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { CodexOutputReader } from "../src/output/codex-reader.js";
import { CodexParser } from "../src/output/codex-parser.js";

function mkTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeJsonl(filePath: string, lines: unknown[]): void {
  const content = lines.map(l => JSON.stringify(l)).join("\n") + "\n";
  fs.writeFileSync(filePath, content, "utf8");
}

function touch(filePath: string, mtimeMs: number): void {
  const t = new Date(mtimeMs);
  fs.utimesSync(filePath, t, t);
}

describe("Codex output", () => {
  const oldEnv = process.env.CODEX_SESSIONS_DIR;
  let dir = "";

  beforeEach(() => {
    dir = mkTmpDir("msgcode-codex-sessions-");
    process.env.CODEX_SESSIONS_DIR = dir;
  });

  afterEach(() => {
    if (oldEnv === undefined) {
      delete process.env.CODEX_SESSIONS_DIR;
    } else {
      process.env.CODEX_SESSIONS_DIR = oldEnv;
    }
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("CodexParser extracts assistant output_text", () => {
    const entries = [
      {
        type: "response_item",
        payload: { type: "message", role: "developer", content: [{ type: "input_text", text: "x" }] },
      },
      {
        type: "response_item",
        payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Hello " }] },
      },
      {
        type: "response_item",
        payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "world" }] },
      },
      {
        type: "response_item",
        payload: { type: "reasoning", content: null },
      },
    ];

    const result = CodexParser.parse(entries as any);
    expect(result.text).toBe("Hello world");
  });

  it("CodexParser falls back to event_msg.agent_message when response_item is missing", () => {
    const entries = [
      { type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { total_tokens: 1 } } } },
      { type: "event_msg", payload: { type: "agent_message", message: "Hello from event" } },
    ];

    const result = CodexParser.parse(entries as any);
    expect(result.text).toBe("Hello from event");
  });

  it("CodexOutputReader reads incrementally by byte offset", async () => {
    const file = path.join(dir, "2026/02/04/rollout-2026-02-04T00-00-00-test.jsonl");
    fs.mkdirSync(path.dirname(file), { recursive: true });

    writeJsonl(file, [
      { type: "session_meta", payload: { cwd: "/tmp/ws", id: "s1" } },
      { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "A" }] } },
    ]);

    const reader = new CodexOutputReader();
    const first = await reader.read(file);
    expect(first.entries.length).toBe(2);

    // Seek to end, then append more
    await reader.seekToEnd(file);
    fs.appendFileSync(file, JSON.stringify({ type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "B" }] } }) + "\n", "utf8");

    const second = await reader.read(file);
    expect(second.entries.length).toBe(1);
    const parsed = CodexParser.parse(second.entries as any);
    expect(parsed.text).toBe("B");
  });

  it("findLatestJsonlForWorkspace filters by cwd", async () => {
    const wsA = "/tmp/ws-A";
    const wsB = "/tmp/ws-B";

    const a1 = path.join(dir, "2026/02/01/rollout-a1.jsonl");
    const b1 = path.join(dir, "2026/02/02/rollout-b1.jsonl");
    const a2 = path.join(dir, "2026/02/03/rollout-a2.jsonl");

    fs.mkdirSync(path.dirname(a1), { recursive: true });
    fs.mkdirSync(path.dirname(b1), { recursive: true });
    fs.mkdirSync(path.dirname(a2), { recursive: true });

    writeJsonl(a1, [{ type: "session_meta", payload: { cwd: wsA, id: "a1" } }]);
    writeJsonl(b1, [{ type: "session_meta", payload: { cwd: wsB, id: "b1" } }]);
    writeJsonl(a2, [{ type: "session_meta", payload: { cwd: wsA, id: "a2" } }]);

    // Control mtime ordering: b1 newest, then a2, then a1
    touch(a1, 1000);
    touch(a2, 2000);
    touch(b1, 3000);

    const reader = new CodexOutputReader();
    const latestForA = await reader.findLatestJsonlForWorkspace(wsA);
    expect(latestForA).toBe(a2);

    const latestForB = await reader.findLatestJsonlForWorkspace(wsB);
    expect(latestForB).toBe(b1);

    const latestForMissing = await reader.findLatestJsonlForWorkspace("/tmp/missing");
    expect(latestForMissing).toBeNull();
  });
});
