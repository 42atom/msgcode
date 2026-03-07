/**
 * msgcode: P5.7-R7B Gmail 只读验收回归锁
 */

import { describe, expect, it } from "bun:test";
import {
  GMAIL_ERROR_CODES,
  GmailReadonlyError,
  runGmailReadonlyAcceptance,
} from "../src/browser/gmail-readonly.js";
import type { BrowserOperationInput, BrowserOperationResult } from "../src/runners/browser-pinchtab.js";

function createExecutor(sequence: Array<(input: BrowserOperationInput) => BrowserOperationResult | Promise<BrowserOperationResult>>) {
  const calls: BrowserOperationInput[] = [];
  let index = 0;

  const execute = async (input: BrowserOperationInput): Promise<BrowserOperationResult> => {
    calls.push(input);
    const handler = sequence[index++];
    if (!handler) {
      throw new Error(`unexpected call: ${input.operation}`);
    }
    return await handler(input);
  };

  return { execute, calls };
}

describe("P5.7-R7B: Gmail readonly acceptance", () => {
  it("已登录 inbox 应返回今日邮件摘要，且不执行副作用动作", async () => {
    const { execute, calls } = createExecutor([
      () => ({ operation: "instances.launch", data: { id: "inst_1" } }),
      () => ({ operation: "tabs.open", data: { tabId: "tab_1" } }),
      (input) => ({ operation: input.operation, data: { result: "https://mail.google.com/mail/u/0/#inbox" } }),
      (input) => ({ operation: input.operation, data: { result: "Inbox (3) - selfwan@gmail.com - Gmail" } }),
      (input) => ({ operation: input.operation, data: { snapshot: '# Gmail | inbox\ncompose\ninbox\nprimary\n' } }),
      (input) => ({ operation: input.operation, data: { text: 'Gmail Inbox Primary Compose inbox' } }),
      (input) => ({
        operation: input.operation,
        data: {
          result: [
            {
              sender: "Alice",
              subject: "Q1 合同修订版",
              snippet: "请确认第 3 条付款条件",
              time: "09:12",
              timeDetail: "Mar 6",
              unread: true,
              rawText: "Alice Q1 合同修订版 请确认第 3 条付款条件 09:12",
            },
            {
              sender: "Google",
              subject: "Security alert",
              snippet: "A new sign-in on your account",
              time: "08:41",
              timeDetail: "Mar 6",
              unread: true,
              rawText: "Google Security alert A new sign-in on your account 08:41",
            },
          ],
        },
      }),
      () => ({ operation: "instances.stop", data: { id: "inst_1", status: "stopped" } }),
    ]);

    const result = await runGmailReadonlyAcceptance({
      profileId: "prof_selfwan",
      timezone: "Asia/Singapore",
      execute,
    });

    expect(result.code).toBe(GMAIL_ERROR_CODES.OK);
    expect(result.count).toBe(2);
    expect(result.messages[0].sender).toBe("Alice");
    expect(result.summary).toContain("今天");
    expect(calls.map((item) => item.operation)).not.toContain("tabs.action");
  });

  it("登录页应 fail-closed 返回 GMAIL_LOGIN_REQUIRED", async () => {
    const { execute } = createExecutor([
      () => ({ operation: "instances.launch", data: { id: "inst_1" } }),
      () => ({ operation: "tabs.open", data: { tabId: "tab_1" } }),
      (input) => ({ operation: input.operation, data: { result: "https://accounts.google.com/v3/signin/identifier" } }),
      (input) => ({ operation: input.operation, data: { result: "Gmail" } }),
      (input) => ({ operation: input.operation, data: { snapshot: '# Gmail | sign in\ncontinue to gmail\n' } }),
      (input) => ({ operation: input.operation, data: { text: 'Sign in Continue to Gmail' } }),
      () => ({ operation: "instances.stop", data: { id: "inst_1", status: "stopped" } }),
    ]);

    await expect(
      runGmailReadonlyAcceptance({
        profileId: "prof_selfwan",
        execute,
      })
    ).rejects.toMatchObject<Partial<GmailReadonlyError>>({
      code: GMAIL_ERROR_CODES.LOGIN_REQUIRED,
    });
  });

  it("inbox 已打开但没有今天新邮件时应返回 count=0", async () => {
    const { execute } = createExecutor([
      () => ({ operation: "instances.launch", data: { id: "inst_1" } }),
      () => ({ operation: "tabs.open", data: { tabId: "tab_1" } }),
      (input) => ({ operation: input.operation, data: { result: "https://mail.google.com/mail/u/0/#inbox" } }),
      (input) => ({ operation: input.operation, data: { result: "Inbox - Gmail" } }),
      (input) => ({ operation: input.operation, data: { snapshot: '# Gmail | inbox\nprimary\n' } }),
      (input) => ({ operation: input.operation, data: { text: 'Gmail Inbox Primary' } }),
      (input) => ({
        operation: input.operation,
        data: {
          result: [
            {
              sender: "Old Sender",
              subject: "Yesterday Mail",
              snippet: "older mail",
              time: "Mar 5",
              timeDetail: "Mar 5",
              unread: false,
              rawText: "Old Sender Yesterday Mail older mail Mar 5",
            },
          ],
        },
      }),
      () => ({ operation: "instances.stop", data: { id: "inst_1", status: "stopped" } }),
    ]);

    const result = await runGmailReadonlyAcceptance({
      profileId: "prof_selfwan",
      timezone: "Asia/Singapore",
      execute,
    });

    expect(result.code).toBe(GMAIL_ERROR_CODES.OK);
    expect(result.count).toBe(0);
    expect(result.summary).toContain("没有识别到新邮件");
  });

  it("收件箱结构无法提取列表时应返回 BROWSER_SITE_CHANGED", async () => {
    const { execute } = createExecutor([
      () => ({ operation: "instances.launch", data: { id: "inst_1" } }),
      () => ({ operation: "tabs.open", data: { tabId: "tab_1" } }),
      (input) => ({ operation: input.operation, data: { result: "https://mail.google.com/mail/u/0/#inbox" } }),
      (input) => ({ operation: input.operation, data: { result: "Inbox - Gmail" } }),
      (input) => ({ operation: input.operation, data: { snapshot: '# Gmail | inbox\nprimary\n' } }),
      (input) => ({ operation: input.operation, data: { text: 'Gmail Inbox Primary' } }),
      (input) => ({ operation: input.operation, data: { result: [] } }),
      (input) => ({ operation: input.operation, data: { result: "https://mail.google.com/mail/u/0/#inbox" } }),
      (input) => ({ operation: input.operation, data: { result: "Inbox - Gmail" } }),
      (input) => ({ operation: input.operation, data: { snapshot: '# Gmail | inbox\nprimary\n' } }),
      (input) => ({ operation: input.operation, data: { text: 'Gmail Inbox Primary' } }),
      () => ({ operation: "instances.stop", data: { id: "inst_1", status: "stopped" } }),
    ]);

    await expect(
      runGmailReadonlyAcceptance({
        profileId: "prof_selfwan",
        execute,
      })
    ).rejects.toMatchObject<Partial<GmailReadonlyError>>({
      code: GMAIL_ERROR_CODES.SITE_CHANGED,
    });
  });
});
