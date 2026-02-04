import assert from "node:assert/strict";

import { Given, When, Then } from "@cucumber/cucumber";

import type { MsgcodeWorld } from "../support/world.ts";
import { __test as commandsTest } from "../../src/commands.js";
import { handleMessage } from "../../src/listener.js";
import { loadState } from "../../src/state/store.js";
import { config } from "../../src/config.js";
import fs from "node:fs";

type FakeImsgClient = {
  sent: Array<{ chat_guid: string; text: string }>;
  send: (params: { chat_guid: string; text: string }) => Promise<{ ok: boolean }>;
};

function ensureWhitelistEmail(email: string): void {
  if (!config.whitelist.emails.includes(email)) {
    config.whitelist.emails.push(email);
  }
}

function createFakeImsgClient(): FakeImsgClient {
  const client: FakeImsgClient = {
    sent: [],
    async send(params) {
      client.sent.push({ chat_guid: params.chat_guid, text: params.text });
      return { ok: true };
    },
  };
  return client;
}

Given("control lane is initialized", function () {
  ensureWhitelistEmail("test@example.com");
  assert.ok(commandsTest, "commands __test hook is unavailable (NODE_ENV=test required)");
  commandsTest.clearFastReplied();
});

When(
  'I fast-lane execute {string} for chat {string} as message {string} rowid {int}',
  async function (this: MsgcodeWorld, text: string, chatId: string, messageId: string, rowid: number) {
    const imsg = createFakeImsgClient();
    (this as any).controlImsg = imsg;

    assert.ok(commandsTest, "commands __test hook is unavailable (NODE_ENV=test required)");
    await commandsTest.handleControlCommandInFastLaneForTest(
      {
        id: messageId,
        rowid,
        chatId,
        text,
        isFromMe: false,
        sender: "test@example.com",
        handle: "test@example.com",
        attachments: [],
      } as any,
      imsg as any
    );
  }
);

Then("fast lane should have sent {int} reply/replies", function (this: MsgcodeWorld, count: number) {
  const imsg = (this as any).controlImsg as FakeImsgClient | undefined;
  assert.ok(imsg, "missing fake imsg client");
  assert.equal(imsg.sent.length, count, `expected ${count} replies, got ${imsg.sent.length}`);
});

When(
  'I queue-handle the same message for chat {string} as message {string} rowid {int}',
  async function (this: MsgcodeWorld, chatId: string, messageId: string, rowid: number) {
    const imsg = (this as any).controlImsg as FakeImsgClient | undefined;
    assert.ok(imsg, "missing fake imsg client");

    await handleMessage(
      {
        id: messageId,
        rowid,
        chatId,
        text: "/where",
        isFromMe: false,
        sender: "test@example.com",
        handle: "test@example.com",
        attachments: [],
      } as any,
      { imsgClient: imsg as any }
    );
  }
);

Then("total replies should be {int}", function (this: MsgcodeWorld, count: number) {
  const imsg = (this as any).controlImsg as FakeImsgClient | undefined;
  assert.ok(imsg, "missing fake imsg client");
  assert.equal(imsg.sent.length, count, `expected ${count} replies, got ${imsg.sent.length}`);
});

Then(
  'cursor for chat {string} should be at least rowid {int}',
  function (this: MsgcodeWorld, chatId: string, rowid: number) {
    const store = loadState();
    const state = store.chats[chatId];
    if (!state) {
      const statePath = process.env.STATE_FILE_PATH;
      const exists = statePath ? fs.existsSync(statePath) : false;
      const content = exists && statePath ? fs.readFileSync(statePath, "utf8") : "(state file missing)";
      throw new Error(
        `expected chat state to exist\n` +
          `STATE_FILE_PATH=${statePath} exists=${exists}\n` +
          `loadState()=${JSON.stringify(store)}\n` +
          `${content}`
      );
    }
    assert.ok(state.lastSeenRowid >= rowid, `expected lastSeenRowid >= ${rowid} but got ${state.lastSeenRowid}`);
  }
);
