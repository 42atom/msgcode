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

function getOrCreateFakeImsgClient(world: MsgcodeWorld): FakeImsgClient {
  const existing = (world as any).controlImsg as FakeImsgClient | undefined;
  if (existing) {
    return existing;
  }
  const imsg = createFakeImsgClient();
  (world as any).controlImsg = imsg;
  return imsg;
}

Given("control lane is initialized", function () {
  ensureWhitelistEmail("test@example.com");
  assert.ok(commandsTest, "commands __test hook is unavailable (NODE_ENV=test required)");
  commandsTest.clearFastReplied();
  commandsTest.clearFastInFlight();
});

When(
  'I fast-lane execute {string} for chat {string} as message {string} rowid {int}',
  async function (this: MsgcodeWorld, text: string, chatId: string, messageId: string, rowid: number) {
    const imsg = getOrCreateFakeImsgClient(this);

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

When(
  'I fast-lane concurrently execute {string} twice for chat {string} rowid {int} as messages {string} and {string}',
  async function (this: MsgcodeWorld, text: string, chatId: string, rowid: number, messageId1: string, messageId2: string) {
    const imsg = getOrCreateFakeImsgClient(this);
    assert.ok(commandsTest, "commands __test hook is unavailable (NODE_ENV=test required)");

    await Promise.all([
      commandsTest.handleControlCommandInFastLaneForTest(
        {
          id: messageId1,
          rowid,
          chatId,
          text,
          isFromMe: false,
          sender: "test@example.com",
          handle: "test@example.com",
          attachments: [],
        } as any,
        imsg as any
      ),
      commandsTest.handleControlCommandInFastLaneForTest(
        {
          id: messageId2,
          rowid,
          chatId,
          text,
          isFromMe: false,
          sender: "test@example.com",
          handle: "test@example.com",
          attachments: [],
        } as any,
        imsg as any
      ),
    ]);
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

// ============================================
// P0: Race Condition Prevention Steps
// ============================================

Given(
  'I have mocked the imsg send with a 200ms delay',
  function (this: MsgcodeWorld) {
    const imsg = createFakeImsgClient();
    // Override send to add a 200ms delay
    const originalSend = imsg.send;
    imsg.send = async (params) => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return originalSend.call(imsg, params);
    };
    (this as any).controlImsg = imsg;

    ensureWhitelistEmail("test@example.com");
    assert.ok(commandsTest, "commands __test hook is unavailable (NODE_ENV=test required)");
    commandsTest.clearFastReplied();
    commandsTest.clearFastInFlight();
  }
);

When(
  'I send message {string} to chat {string}',
  async function (this: MsgcodeWorld, text: string, chatId: string) {
    const imsg = (this as any).controlImsg as FakeImsgClient;
    assert.ok(imsg, "missing fake imsg client");

    // Store the message for use in subsequent steps
    const messageId = `msg-${Date.now()}`;
    const rowid = Math.floor(Math.random() * 1000000);
    (this as any).raceTestMessage = {
      id: messageId,
      rowid,
      chatId,
      text,
      isFromMe: false,
      sender: "test@example.com",
      handle: "test@example.com",
      attachments: [],
    };

    // Trigger fast lane processing (non-blocking, starts async)
    commandsTest!.handleControlCommandInFastLaneForTest(
      (this as any).raceTestMessage,
      imsg as any
    ).catch(() => {
      // Ignore errors for this test
    });
  }
);

When(
  'I immediately process the queue lane for the same message',
  async function (this: MsgcodeWorld) {
    // Wait a tiny bit to ensure fast lane has started but not finished
    await new Promise((resolve) => setTimeout(resolve, 10));

    // The fast lane should still be in-flight (200ms delay)
    // This simulates the race condition window
    const imsg = (this as any).controlImsg as FakeImsgClient;
    assert.ok(imsg, "missing fake imsg client");

    // Import isFastLaneInFlight to verify the race condition scenario
    const { isFastLaneInFlight } = await import("../../src/commands.js");

    // Get the message that was sent to fast lane
    const testMessage = (this as any).raceTestMessage;
    assert.ok(testMessage, "no message was stored for testing");

    // Verify fast lane is still in-flight (this is the key assertion)
    assert.ok(
      isFastLaneInFlight(testMessage),
      "Expected fast lane to still be in-flight (race condition scenario)"
    );

    // Now process the same message in the queue lane
    // It should skip processing because isFastLaneInFlight === true
    await handleMessage(testMessage, { imsgClient: imsg as any });
  }
);

Then(
  'the message should be replied to exactly 1 time',
  async function (this: MsgcodeWorld) {
    const imsg = (this as any).controlImsg as FakeImsgClient;
    assert.ok(imsg, "missing fake imsg client");

    // Wait for fast lane to complete (200ms delay + margin)
    await new Promise((resolve) => setTimeout(resolve, 250));

    // Count how many times the message was replied to
    // Fast lane sent 1 reply, queue lane should have skipped (sent 0)
    // Total should be exactly 1
    assert.equal(imsg.sent.length, 1, `expected exactly 1 reply, but got ${imsg.sent.length}`);
  }
);
