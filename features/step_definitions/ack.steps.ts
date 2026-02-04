import assert from "node:assert/strict";

import { Given, When, Then } from "@cucumber/cucumber";

import { __test as listenerTest } from "../../src/listener.js";

type FakeImsgClient = {
  sent: Array<{ chat_guid: string; text: string }>;
  send: (params: { chat_guid: string; text: string }) => Promise<{ ok: boolean }>;
};

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

Given("acknowledgement delay is {int}ms", function (delayMs: number) {
  process.env.MSGCODE_ACK_DELAY_MS = String(delayMs);
  assert.ok(listenerTest, "listener __test hook is unavailable (NODE_ENV=test required)");
  assert.equal(listenerTest.getAcknowledgementDelayMs(), delayMs);
});

When(
  'I run acknowledgement wrapper for content {string} with handler duration {int}ms',
  async function (this: any, content: string, durationMs: number) {
    const imsg = createFakeImsgClient();
    // store for assertions
    (this as any).ackImsg = imsg;

    assert.ok(listenerTest, "listener __test hook is unavailable (NODE_ENV=test required)");
    await listenerTest.withAcknowledgement(
      imsg as any,
      "any;+;bdd-ack",
      content,
      async () => {
        await new Promise((r) => setTimeout(r, durationMs));
        return "ok";
      }
    );
  }
);

Then("I should receive {int} acknowledgement(s)", function (this: any, count: number) {
  const imsg = (this as any).ackImsg as FakeImsgClient | undefined;
  assert.ok(imsg, "missing fake imsg client");
  const ackCount = imsg.sent.filter((m) => m.text === listenerTest.ACKNOWLEDGEMENT_TEXT).length;
  assert.equal(ackCount, count, `expected ${count} acks but got ${ackCount}; sent=${JSON.stringify(imsg.sent)}`);
});
