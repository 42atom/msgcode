import assert from "node:assert/strict";

import { Given, When, Then } from "@cucumber/cucumber";

import type { MsgcodeWorld } from "../support/world.ts";
import { getSession, upsertSession, updateSessionStopTime } from "../../src/tmux/registry.js";

Given(
  'a session registry record exists for session {string}',
  async function (this: MsgcodeWorld, sessionName: string) {
    await upsertSession({
      sessionName,
      groupName: "bdd-group",
      projectDir: "/tmp/bdd",
      runner: "codex",
    });
    const record = await getSession(sessionName);
    assert.ok(record);
  }
);

When('I mark the session {string} as stopped', async function (this: MsgcodeWorld, sessionName: string) {
  await updateSessionStopTime(sessionName);
});

When('I upsert the same session {string} again', async function (this: MsgcodeWorld, sessionName: string) {
  await upsertSession({
    sessionName,
    groupName: "bdd-group",
    projectDir: "/tmp/bdd",
    runner: "codex",
  });
});

Then(
  'the session {string} should have lastStopAtMs > 0',
  async function (this: MsgcodeWorld, sessionName: string) {
    const record = await getSession(sessionName);
    assert.ok(record);
    assert.ok(record.lastStopAtMs > 0, `expected lastStopAtMs > 0 but got ${record.lastStopAtMs}`);
  }
);
