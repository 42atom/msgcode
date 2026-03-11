/**
 * msgcode: Gmail 只读验收流（R7B）
 *
 * 约束：
 * - 只读
 * - 显式 rootName / instanceId / tabId
 * - 不做自动登录
 */

import { setTimeout as sleep } from "node:timers/promises";
import {
  executeBrowserOperation,
  BrowserCommandError,
  type BrowserOperationInput,
  type BrowserOperationResult,
} from "../runners/browser-patchright.js";

const GMAIL_INBOX_URL = "https://mail.google.com/mail/u/0/#inbox";
const DEFAULT_TIMEZONE = "Asia/Singapore";
const PAGE_SETTLE_DELAY_MS = 1500;
const PAGE_POLL_ATTEMPTS = 3;

export const GMAIL_ERROR_CODES = {
  OK: "OK",
  BAD_ARGS: "GMAIL_BAD_ARGS",
  EXTRACTION_FAILED: "GMAIL_EXTRACTION_FAILED",
  LOGIN_REQUIRED: "GMAIL_LOGIN_REQUIRED",
  SITE_CHANGED: "BROWSER_SITE_CHANGED",
} as const;

export type GmailErrorCode =
  typeof GMAIL_ERROR_CODES[keyof typeof GMAIL_ERROR_CODES];

export interface GmailReadonlyMessage {
  sender: string;
  subject: string;
  time: string;
  snippet: string;
  unread: boolean;
}

export interface GmailReadonlyResult {
  code: GmailErrorCode;
  rootName: string;
  instanceId: string;
  tabId: string;
  timezone: string;
  page: {
    state: "gmail-inbox" | "gmail-login" | "unknown";
    url: string;
    title: string;
  };
  count: number;
  messages: GmailReadonlyMessage[];
  summary: string;
  evidence: {
    snapshotExcerpt: string;
    textExcerpt: string;
  };
}

export class GmailReadonlyError extends Error {
  readonly code: GmailErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    code: GmailErrorCode,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "GmailReadonlyError";
    this.code = code;
    this.details = details;
  }
}

export type BrowserExecutor = (
  input: BrowserOperationInput
) => Promise<BrowserOperationResult>;

export interface GmailReadonlyParams {
  rootName?: string;
  profileId?: string;
  mode?: "headed" | "headless";
  timezone?: string;
  timeoutMs?: number;
  cleanup?: boolean;
  execute?: BrowserExecutor;
}

interface GmailPageState {
  state: "gmail-inbox" | "gmail-login" | "unknown";
  url: string;
  title: string;
  snapshotExcerpt: string;
  textExcerpt: string;
}

interface RawMailboxRow {
  sender: string;
  subject: string;
  snippet: string;
  time: string;
  timeDetail: string;
  unread: boolean;
  rawText: string;
}

function requireNonEmpty(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new GmailReadonlyError(
      GMAIL_ERROR_CODES.BAD_ARGS,
      `${fieldName} must be a non-empty string`
    );
  }
  return value.trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function excerpt(value: string, maxChars = 800): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars)}...`;
}

function isTimeOnly(text: string): boolean {
  const normalized = text.trim();
  return /^(\d{1,2}:\d{2})(\s?[AP]M)?$/i.test(normalized);
}

function buildTodayTokens(timezone: string): string[] {
  const now = new Date();
  const year = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
  }).format(now);
  const monthShort = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "short",
  }).format(now);
  const monthLong = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "long",
  }).format(now);
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    day: "numeric",
  }).format(now);
  const weekdayShort = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
  }).format(now);
  const weekdayLong = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
  }).format(now);
  const isoDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  return [
    `${monthShort} ${day}`,
    `${monthLong} ${day}`,
    `${day} ${monthShort}`,
    `${day} ${monthLong}`,
    `${monthShort} ${day}, ${year}`,
    `${day} ${monthShort} ${year}`,
    `${weekdayShort}, ${monthShort} ${day}`,
    `${weekdayLong}, ${monthLong} ${day}`,
    weekdayShort,
    weekdayLong,
    isoDate,
  ].map((token) => token.toLowerCase());
}

function looksLikeToday(row: RawMailboxRow, timezone: string): boolean {
  if (isTimeOnly(row.time)) {
    return true;
  }

  const haystack = `${row.time} ${row.timeDetail} ${row.rawText}`.toLowerCase();
  return buildTodayTokens(timezone).some((token) => token && haystack.includes(token));
}

function dedupeMessages(rows: GmailReadonlyMessage[]): GmailReadonlyMessage[] {
  const seen = new Set<string>();
  const result: GmailReadonlyMessage[] = [];

  for (const row of rows) {
    const key = `${row.sender}::${row.subject}::${row.time}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(row);
  }

  return result;
}

function summarizeMessages(messages: GmailReadonlyMessage[], timezone: string): string {
  const dateLabel = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  if (messages.length === 0) {
    return `今天（${dateLabel}）我在 Gmail 收件箱中没有识别到新邮件。`;
  }

  const lines = [`今天（${dateLabel}）我在 Gmail 收件箱中发现 ${messages.length} 封今日新邮件：`, ""];
  for (const [index, message] of messages.entries()) {
    lines.push(`${index + 1}. 发件人：${message.sender}`);
    lines.push(`   主题：${message.subject}`);
    lines.push(`   时间：${message.time}`);
    lines.push(`   摘要：${message.snippet}`);
    lines.push("");
  }
  return lines.join("\n").trim();
}

async function callBrowser(
  execute: BrowserExecutor,
  input: BrowserOperationInput
): Promise<Record<string, unknown>> {
  const result = await execute(input);
  return asRecord(result.data);
}

async function inspectPage(
  execute: BrowserExecutor,
  tabId: string,
  timeoutMs?: number
): Promise<GmailPageState> {
  let lastState: GmailPageState = {
    state: "unknown",
    url: "",
    title: "",
    snapshotExcerpt: "",
    textExcerpt: "",
  };

  for (let attempt = 0; attempt < PAGE_POLL_ATTEMPTS; attempt++) {
    const [urlResult, titleResult, snapshotResult, textResult] = await Promise.all([
      callBrowser(execute, {
        operation: "tabs.eval",
        tabId,
        expression: "location.href",
        timeoutMs,
      }),
      callBrowser(execute, {
        operation: "tabs.eval",
        tabId,
        expression: "document.title",
        timeoutMs,
      }),
      callBrowser(execute, {
        operation: "tabs.snapshot",
        tabId,
        interactive: true,
        compact: true,
        timeoutMs,
      }),
      callBrowser(execute, {
        operation: "tabs.text",
        tabId,
        timeoutMs,
      }),
    ]);

    const url = String(urlResult.result ?? "");
    const title = String(titleResult.result ?? "");
    const snapshotText = String(snapshotResult.snapshot ?? "");
    const text = String(textResult.text ?? "");
    const combined = `${url}\n${title}\n${snapshotText}\n${text}`.toLowerCase();

    let state: GmailPageState["state"] = "unknown";
    if (
      url.includes("accounts.google.com")
      || combined.includes("sign in")
      || combined.includes("choose an account")
      || combined.includes("continue to gmail")
      || combined.includes("登录")
    ) {
      state = "gmail-login";
    } else if (
      url.includes("mail.google.com")
      && (
        combined.includes("gmail")
        || combined.includes("compose")
        || combined.includes("inbox")
        || combined.includes("primary")
      )
    ) {
      state = "gmail-inbox";
    }

    lastState = {
      state,
      url,
      title,
      snapshotExcerpt: excerpt(snapshotText),
      textExcerpt: excerpt(text),
    };

    if (state !== "unknown") {
      return lastState;
    }

    if (attempt < PAGE_POLL_ATTEMPTS - 1) {
      await sleep(PAGE_SETTLE_DELAY_MS);
    }
  }

  return lastState;
}

const GMAIL_ROW_EXTRACTION_SCRIPT = String.raw`(() => {
  function firstText(root, selectors) {
    for (const selector of selectors) {
      const node = root.querySelector(selector);
      const value = node && node.textContent ? node.textContent.replace(/\s+/g, ' ').trim() : '';
      if (value) return value;
    }
    return '';
  }

  function firstAttr(root, selectors, attr) {
    for (const selector of selectors) {
      const node = root.querySelector(selector);
      const value = node && node.getAttribute ? node.getAttribute(attr) : '';
      if (value) return value.trim();
    }
    return '';
  }

  const rows = Array.from(document.querySelectorAll('tr.zA, tr[role="row"][data-legacy-thread-id], tr[data-legacy-thread-id]'));
  return rows.slice(0, 50).map((row) => ({
    sender: firstText(row, ['span[email]', '.yW span', 'span.yP', '[data-hovercard-id]', 'td:nth-child(4) span']),
    subject: firstText(row, ['span.bog', '.bog', '.y6 span', 'td:nth-child(5) span']),
    snippet: firstText(row, ['span.y2', '.y2', '.xY .y2', '.bog + .y2']),
    time: firstText(row, ['td.xW span', 'td.xW', 'span.xT', 'td:nth-last-child(1) span']),
    timeDetail: firstAttr(row, ['td.xW span', 'td.xW [title]', '[title]'], 'title'),
    unread: row.classList.contains('zE') || (row.getAttribute('aria-label') || '').toLowerCase().includes('unread'),
    rawText: (row.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 400),
  })).filter((row) => row.sender || row.subject);
})()`;

async function readMailboxRows(
  execute: BrowserExecutor,
  tabId: string,
  timeoutMs?: number
): Promise<RawMailboxRow[]> {
  const evalResult = await callBrowser(execute, {
    operation: "tabs.eval",
    tabId,
    expression: GMAIL_ROW_EXTRACTION_SCRIPT,
    timeoutMs,
  });

  const rawRows = Array.isArray(evalResult.result)
    ? evalResult.result as RawMailboxRow[]
    : [];

  return rawRows;
}

function mapTodayMessages(
  rawRows: RawMailboxRow[],
  timezone: string
): GmailReadonlyMessage[] {
  const mapped = rawRows
    .filter((row) => row.sender && row.subject)
    .filter((row) => looksLikeToday(row, timezone))
    .map((row) => ({
      sender: row.sender,
      subject: row.subject,
      time: row.time || row.timeDetail || "未知",
      snippet: row.snippet || row.rawText || "无摘要",
      unread: !!row.unread,
    }));

  return dedupeMessages(mapped);
}

export async function runGmailReadonlyAcceptance(
  params: GmailReadonlyParams
): Promise<GmailReadonlyResult> {
  const rootName = requireNonEmpty(params.rootName ?? params.profileId ?? "work-default", "rootName");
  const mode = params.mode ?? "headless";
  const timezone = params.timezone ?? DEFAULT_TIMEZONE;
  const execute = params.execute ?? executeBrowserOperation;
  const cleanup = params.cleanup ?? true;

  let instanceId = "";
  let tabId = "";

  try {
    const launch = await callBrowser(execute, {
      operation: "instances.launch",
      rootName,
      mode,
      timeoutMs: params.timeoutMs,
    });
    instanceId = requireNonEmpty(launch.id, "instanceId");

    const opened = await callBrowser(execute, {
      operation: "tabs.open",
      instanceId,
      url: GMAIL_INBOX_URL,
      timeoutMs: params.timeoutMs,
    });
    tabId = requireNonEmpty(opened.tabId, "tabId");

    await sleep(PAGE_SETTLE_DELAY_MS);

    const page = await inspectPage(execute, tabId, params.timeoutMs);
    if (page.state === "gmail-login") {
      throw new GmailReadonlyError(
        GMAIL_ERROR_CODES.LOGIN_REQUIRED,
        "Gmail is not logged in for the selected profile",
        { rootName, instanceId, tabId, page }
      );
    }
    if (page.state !== "gmail-inbox") {
      throw new GmailReadonlyError(
        GMAIL_ERROR_CODES.SITE_CHANGED,
        "Unable to confirm Gmail inbox from the current page structure",
        { rootName, instanceId, tabId, page }
      );
    }

    const rawRows = await readMailboxRows(execute, tabId, params.timeoutMs);
    if (rawRows.length === 0) {
      const pageForFailure = await inspectPage(execute, tabId, params.timeoutMs);
      throw new GmailReadonlyError(
        GMAIL_ERROR_CODES.SITE_CHANGED,
        "Gmail inbox opened but mailbox rows could not be extracted from the current page structure",
        { rootName, instanceId, tabId, page: pageForFailure }
      );
    }
    const messages = mapTodayMessages(rawRows, timezone);

    return {
      code: GMAIL_ERROR_CODES.OK,
      rootName,
      instanceId,
      tabId,
      timezone,
      page: {
        state: page.state,
        url: page.url,
        title: page.title,
      },
      count: messages.length,
      messages,
      summary: summarizeMessages(messages, timezone),
      evidence: {
        snapshotExcerpt: page.snapshotExcerpt,
        textExcerpt: page.textExcerpt,
      },
    };
  } catch (error) {
    if (error instanceof GmailReadonlyError) {
      throw error;
    }
    if (error instanceof BrowserCommandError) {
      throw new GmailReadonlyError(
        GMAIL_ERROR_CODES.EXTRACTION_FAILED,
        `${error.code}: ${error.message}`,
        { rootName, instanceId, tabId }
      );
    }
    throw new GmailReadonlyError(
      GMAIL_ERROR_CODES.EXTRACTION_FAILED,
      error instanceof Error ? error.message : String(error),
      { rootName, instanceId, tabId }
    );
  } finally {
    if (cleanup && instanceId) {
      try {
        await callBrowser(execute, {
          operation: "instances.stop",
          instanceId,
          timeoutMs: params.timeoutMs,
        });
      } catch {
        // best-effort cleanup
      }
    }
  }
}
