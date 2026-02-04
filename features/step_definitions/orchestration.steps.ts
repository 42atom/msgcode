import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

import { Given, When, Then } from "@cucumber/cucumber";

import type { MsgcodeWorld } from "../support/world.ts";
import { parseRouteCommand, handleRouteCommand } from "../../src/routes/commands.js";

Given("a clean workspace root", function (this: MsgcodeWorld) {
  // World constructor already creates isolated temp dirs.
  assert.ok(fs.existsSync(this.workspaceRoot));
});

Given(
  'I bind chat {string} to workspace {string}',
  async function (this: MsgcodeWorld, chatId: string, workspaceRel: string) {
    // Ensure workspace exists so downstream commands can reference it.
    const workspacePath = this.getWorkspacePath(workspaceRel);
    fs.mkdirSync(workspacePath, { recursive: true });

    const parsed = parseRouteCommand(`/bind ${workspaceRel}`);
    assert.ok(parsed, "bind command should parse");
    const result = await handleRouteCommand(parsed.command, { chatId, args: parsed.args });
    this.lastResult = { success: result.success, message: result.message };
    assert.ok(result.success, `bind should succeed: ${result.message}`);
  }
);

Given(
  'workspace {string} has persona {string} with content:',
  function (this: MsgcodeWorld, workspaceRel: string, personaId: string, docString: string) {
    const workspacePath = this.getWorkspacePath(workspaceRel);
    const personasDir = path.join(workspacePath, ".msgcode", "personas");
    fs.mkdirSync(personasDir, { recursive: true });
    fs.writeFileSync(path.join(personasDir, `${personaId}.md`), docString, "utf8");
  }
);

Given(
  'workspace {string} has schedule {string} with json:',
  function (this: MsgcodeWorld, workspaceRel: string, scheduleId: string, docString: string) {
    const workspacePath = this.getWorkspacePath(workspaceRel);
    const schedulesDir = path.join(workspacePath, ".msgcode", "schedules");
    fs.mkdirSync(schedulesDir, { recursive: true });
    fs.writeFileSync(path.join(schedulesDir, `${scheduleId}.json`), docString, "utf8");
  }
);

When(
  'I run route command {string} for chat {string}',
  async function (this: MsgcodeWorld, text: string, chatId: string) {
    const parsed = parseRouteCommand(text);
    assert.ok(parsed, `command should parse: ${text}`);
    const result = await handleRouteCommand(parsed.command, { chatId, args: parsed.args });
    this.lastResult = { success: result.success, message: result.message };
  }
);

Then("the command should succeed", function (this: MsgcodeWorld) {
  assert.ok(this.lastResult, "no command result recorded");
  assert.equal(this.lastResult.success, true, `expected success but got: ${this.lastResult.message}`);
});

Then(
  'the output should contain {string}',
  function (this: MsgcodeWorld, expected: string) {
    assert.ok(this.lastResult, "no command result recorded");
    assert.ok(
      this.lastResult.message.includes(expected),
      `expected output to contain "${expected}" but got:\n${this.lastResult.message}`
    );
  }
);

Then(
  'jobs.json should contain a schedule job for workspace {string} and schedule {string}',
  function (this: MsgcodeWorld, _workspaceRel: string, scheduleId: string) {
    const jobsPath = path.join(this.tmpHome, ".config", "msgcode", "cron", "jobs.json");
    assert.ok(fs.existsSync(jobsPath), `jobs.json not found at ${jobsPath}`);
    const raw = fs.readFileSync(jobsPath, "utf8");
    const parsed = JSON.parse(raw) as { version: number; jobs: Array<{ id: string; name: string }> };
    assert.equal(parsed.version, 1);

    const job = parsed.jobs.find((j) => j.id.endsWith(`:${scheduleId}`));
    assert.ok(job, `expected a schedule job ending with :${scheduleId}`);
    // Ensure stable prefix.
    assert.ok(job.id.startsWith("schedule:"), `expected schedule jobId prefix but got: ${job.id}`);

    // Also check name matches scheduleId (current mapping)
    assert.equal(job.name, scheduleId);

    // workspaceRel currently only affects the hash portion; we just ensure it exists
    assert.ok(job.id.split(":")[1]?.length > 0, `expected non-empty workspace hash in jobId: ${job.id}`);
  }
);

// ============================================
// P0-1: Schedule Merge Strategy Steps
// ============================================

Given(
  'jobs.json contains a manual job with id {string}',
  function (this: MsgcodeWorld, jobId: string) {
    const jobsDir = path.join(this.tmpHome, ".config", "msgcode", "cron");
    fs.mkdirSync(jobsDir, { recursive: true });
    const jobsPath = path.join(jobsDir, "jobs.json");

    const now = Date.now();
    const jobs = {
      version: 1,
      jobs: [
        {
          id: jobId,
          enabled: true,
          name: "manual-job",
          description: "A manually created job",
          route: { chatGuid: "any;+;test" },
          schedule: { kind: "cron" as const, expr: "0 9 * * *", tz: "Asia/Shanghai" },
          sessionTarget: "main" as const,
          payload: { kind: "tmuxMessage" as const, text: "Test message" },
          delivery: { mode: "reply-to-same-chat" as const, bestEffort: true, maxChars: 2000 },
          state: {
            routeStatus: "valid" as const,
            nextRunAtMs: null,
            runningAtMs: null,
            lastRunAtMs: null,
            lastStatus: "pending" as const,
            lastErrorCode: null,
            lastError: null,
            lastDurationMs: null,
          },
          createdAtMs: now,
          updatedAtMs: now,
        },
      ],
    };
    fs.writeFileSync(jobsPath, JSON.stringify(jobs, null, 2), "utf8");
  }
);

Then(
  'jobs.json should contain job with id {string}',
  function (this: MsgcodeWorld, jobId: string) {
    const jobsPath = path.join(this.tmpHome, ".config", "msgcode", "cron", "jobs.json");
    assert.ok(fs.existsSync(jobsPath), `jobs.json not found at ${jobsPath}`);
    const raw = fs.readFileSync(jobsPath, "utf8");
    const parsed = JSON.parse(raw) as { version: number; jobs: Array<{ id: string }> };
    assert.equal(parsed.version, 1);

    const job = parsed.jobs.find((j) => j.id === jobId);
    assert.ok(job, `expected job with id "${jobId}" but not found in jobs.json`);
  }
);

Then(
  'jobs.json should have at least {int} jobs',
  function (this: MsgcodeWorld, minCount: number) {
    const jobsPath = path.join(this.tmpHome, ".config", "msgcode", "cron", "jobs.json");
    assert.ok(fs.existsSync(jobsPath), `jobs.json not found at ${jobsPath}`);
    const raw = fs.readFileSync(jobsPath, "utf8");
    const parsed = JSON.parse(raw) as { version: number; jobs: unknown[] };
    assert.equal(parsed.version, 1);

    assert.ok(
      parsed.jobs.length >= minCount,
      `expected at least ${minCount} jobs but got ${parsed.jobs.length}`
    );
  }
);

Then("the command should fail", function (this: MsgcodeWorld) {
  assert.ok(this.lastResult, "no command result recorded");
  assert.equal(this.lastResult.success, false, `expected failure but got success`);
});

