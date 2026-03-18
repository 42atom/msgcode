/**
 * msgcode: Patchright Browser Core Runner
 *
 * 约束：
 * - 正式浏览器主链固定为 Patchright + connectOverCDP
 * - Chrome 进程是状态真相源，不引入 daemon
 * - ref 必须可跨调用重建，格式固定为 role + name + index
 */

import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  ensureChromeRoot,
  getChromeProfilesRoot,
  getChromeRootInfo,
  getChromeBinaryPath,
  type ChromeRootInfo,
} from "../browser/chrome-root.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_CDP_HOST = "127.0.0.1";
const INSTANCE_ID_PREFIX = "chrome";
const INSTANCE_STATE_DIR = ".browser";
const INSTANCE_STATE_SUFFIX = ".json";

export const BROWSER_ERROR_CODES = {
  OK: "OK",
  BAD_ARGS: "BROWSER_BAD_ARGS",
  HTTP_ERROR: "BROWSER_HTTP_ERROR",
  INSTANCE_NOT_FOUND: "BROWSER_INSTANCE_NOT_FOUND",
  REF_NOT_FOUND: "BROWSER_REF_NOT_FOUND",
  RUNTIME_UNAVAILABLE: "BROWSER_RUNTIME_UNAVAILABLE",
  TAB_NOT_FOUND: "BROWSER_TAB_NOT_FOUND",
  TIMEOUT: "BROWSER_TIMEOUT",
} as const;

export type BrowserErrorCode =
  typeof BROWSER_ERROR_CODES[keyof typeof BROWSER_ERROR_CODES];

export type BrowserOperation =
  | "health"
  | "profiles.list"
  | "instances.list"
  | "instances.launch"
  | "instances.stop"
  | "tabs.open"
  | "tabs.list"
  | "tabs.snapshot"
  | "tabs.text"
  | "tabs.action"
  | "tabs.eval";

export interface BrowserOperationInput {
  operation: BrowserOperation;
  mode?: "headed" | "headless";
  rootName?: string;
  profileId?: string;
  instanceId?: string;
  tabId?: string;
  url?: string;
  kind?: string;
  ref?: string;
  text?: string;
  key?: string;
  expression?: string;
  interactive?: boolean;
  compact?: boolean;
  port?: string | number;
  timeoutMs?: number;
}

export interface BrowserProfile {
  id: string;
  rootName: string;
  path: string;
  pathExists: boolean;
}

export interface BrowserInstance {
  id: string;
  rootName: string;
  chromeRoot: string;
  port: string;
  headless: boolean;
  status: string;
  pid?: number;
  startTime?: string;
}

export interface BrowserTabSummary {
  id: string;
  title: string;
  type: string;
  url: string;
}

export interface BrowserOperationResult {
  operation: BrowserOperation;
  data: Record<string, unknown>;
}

export class BrowserCommandError extends Error {
  readonly code: BrowserErrorCode;
  readonly status?: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: BrowserErrorCode,
    message: string,
    options?: { status?: number; details?: Record<string, unknown> }
  ) {
    super(message);
    this.name = "BrowserCommandError";
    this.code = code;
    this.status = options?.status;
    this.details = options?.details;
  }
}

interface BrowserInstanceState extends BrowserInstance {
  mode: "headed" | "headless";
}

interface BrowserRefDescriptor {
  role: string;
  name: string;
  index: number;
}

interface SnapshotRefEntry extends BrowserRefDescriptor {
  ref: string;
  tag: string;
  text: string;
}

interface PatchrightBrowserLike {
  contexts(): Array<{
    pages(): Array<unknown>;
    newPage(): Promise<unknown>;
  }>;
  close(): Promise<void>;
}

interface PatchrightLike {
  connectOverCDP(url: string): Promise<PatchrightBrowserLike>;
}

interface BrowserRuntimeDeps {
  fetchImpl: typeof fetch;
  spawnProcess: (
    command: string,
    args: string[],
    options: SpawnOptions
  ) => ChildProcess;
  resolvePatchright: () => PatchrightLike;
}

const require = createRequire(import.meta.url);

const runtimeDeps: BrowserRuntimeDeps = {
  fetchImpl: fetch,
  spawnProcess: spawn,
  resolvePatchright: () => {
    const patchright = require("patchright") as { chromium?: PatchrightLike };
    if (!patchright?.chromium) {
      throw new BrowserCommandError(
        BROWSER_ERROR_CODES.RUNTIME_UNAVAILABLE,
        "patchright dependency is not installed"
      );
    }
    return patchright.chromium;
  },
};

export function __setBrowserPatchrightTestDeps(
  overrides: Partial<BrowserRuntimeDeps>
): void {
  if (overrides.fetchImpl) {
    runtimeDeps.fetchImpl = overrides.fetchImpl;
  }
  if (overrides.spawnProcess) {
    runtimeDeps.spawnProcess = overrides.spawnProcess;
  }
  if (overrides.resolvePatchright) {
    runtimeDeps.resolvePatchright = overrides.resolvePatchright;
  }
}

function getInstanceStateDir(): string {
  return join(getChromeProfilesRoot(), INSTANCE_STATE_DIR);
}

function getStateFilePath(rootName: string, port: number): string {
  return join(getInstanceStateDir(), `${rootName}-${port}${INSTANCE_STATE_SUFFIX}`);
}

function buildInstanceId(rootName: string, port: number): string {
  return `${INSTANCE_ID_PREFIX}:${rootName}:${port}`;
}

function parseInstanceId(instanceId: string): { rootName: string; port: number } {
  const trimmed = requireNonEmptyString(instanceId, "instanceId");
  const match = /^chrome:([A-Za-z0-9._-]+):(\d+)$/.exec(trimmed);
  if (!match) {
    throw new BrowserCommandError(
      BROWSER_ERROR_CODES.BAD_ARGS,
      "instanceId must match chrome:<rootName>:<port>",
      { details: { instanceId: trimmed } }
    );
  }

  return {
    rootName: match[1],
    port: normalizePort(match[2]),
  };
}

function resolveRootName(input: BrowserOperationInput): string {
  const raw = input.rootName ?? input.profileId;
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed || "work-default";
}

function requireNonEmptyString(
  value: unknown,
  fieldName: string
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new BrowserCommandError(
      BROWSER_ERROR_CODES.BAD_ARGS,
      `${fieldName} must be a non-empty string`
    );
  }
  return value.trim();
}

function normalizeMode(value: unknown): "headed" | "headless" {
  const mode = typeof value === "string" ? value.trim() : "";
  if (mode === "headed" || mode === "headless") {
    return mode;
  }
  throw new BrowserCommandError(
    BROWSER_ERROR_CODES.BAD_ARGS,
    "mode must be headed or headless"
  );
}

function normalizePort(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new BrowserCommandError(
      BROWSER_ERROR_CODES.BAD_ARGS,
      "port must be an integer between 1 and 65535",
      { details: { port: value } }
    );
  }
  return parsed;
}

function getTimeoutMs(input?: BrowserOperationInput): number {
  return input?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function isAbortError(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as { name?: unknown }).name === "AbortError";
}

function createTimeoutController(timeoutMs: number): {
  controller: AbortController;
  clear: () => void;
} {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    controller,
    clear: () => clearTimeout(timer),
  };
}

async function fetchJson(
  url: string,
  timeoutMs: number
): Promise<Record<string, unknown>> {
  const { controller, clear } = createTimeoutController(timeoutMs);

  try {
    const response = await runtimeDeps.fetchImpl(url, {
      method: "GET",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new BrowserCommandError(
        BROWSER_ERROR_CODES.HTTP_ERROR,
        `request failed with status ${response.status}`,
        { status: response.status, details: { url } }
      );
    }
    return asRecord(await response.json());
  } catch (error) {
    if (error instanceof BrowserCommandError) {
      throw error;
    }
    if (isAbortError(error)) {
      throw new BrowserCommandError(
        BROWSER_ERROR_CODES.TIMEOUT,
        `request timed out after ${timeoutMs}ms`,
        { details: { url } }
      );
    }
    throw new BrowserCommandError(
      BROWSER_ERROR_CODES.RUNTIME_UNAVAILABLE,
      error instanceof Error ? error.message : String(error),
      { details: { url } }
    );
  } finally {
    clear();
  }
}

async function isCdpReady(port: number, timeoutMs: number): Promise<boolean> {
  try {
    const version = await fetchJson(`http://${DEFAULT_CDP_HOST}:${port}/json/version`, timeoutMs);
    return typeof version.webSocketDebuggerUrl === "string" && version.webSocketDebuggerUrl.trim().length > 0;
  } catch {
    return false;
  }
}

async function waitForCdpReady(port: number, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isCdpReady(port, 1_500)) {
      return;
    }
    await sleep(250);
  }
  throw new BrowserCommandError(
    BROWSER_ERROR_CODES.TIMEOUT,
    `Chrome CDP endpoint did not become ready on port ${port} within ${timeoutMs}ms`,
    { details: { port } }
  );
}

function processExists(pid?: number): boolean {
  if (!pid || !Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function ensureInstanceStateDir(): Promise<void> {
  await mkdir(getInstanceStateDir(), { recursive: true });
}

async function loadInstanceStateByPath(filePath: string): Promise<BrowserInstanceState | null> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf-8")) as BrowserInstanceState;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    if (typeof parsed.id !== "string" || typeof parsed.rootName !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function saveInstanceState(state: BrowserInstanceState): Promise<void> {
  await ensureInstanceStateDir();
  await writeFile(
    getStateFilePath(state.rootName, Number(state.port)),
    `${JSON.stringify(state, null, 2)}\n`,
    "utf-8"
  );
}

async function removeInstanceState(rootName: string, port: number): Promise<void> {
  await rm(getStateFilePath(rootName, port), { force: true });
}

async function loadInstanceState(
  instanceId: string
): Promise<BrowserInstanceState | null> {
  const { rootName, port } = parseInstanceId(instanceId);
  return await loadInstanceStateByPath(getStateFilePath(rootName, port));
}

async function listInstanceStates(): Promise<BrowserInstanceState[]> {
  await ensureInstanceStateDir();
  const files = await readdir(getInstanceStateDir()).catch(() => [] as string[]);
  const states: BrowserInstanceState[] = [];

  for (const file of files) {
    if (!file.endsWith(INSTANCE_STATE_SUFFIX)) {
      continue;
    }
    const state = await loadInstanceStateByPath(join(getInstanceStateDir(), file));
    if (!state) {
      continue;
    }
    states.push(state);
  }

  // Stable ordering:
  // - Prefer most recently used instances to minimize wasted CDP probes
  // - Keep deterministic tie-break to avoid "random first file blocks the whole scan"
  return states.sort((a, b) => {
    const aTs = Date.parse(a.startTime ?? "") || 0;
    const bTs = Date.parse(b.startTime ?? "") || 0;
    if (aTs !== bTs) {
      return bTs - aTs;
    }
    return a.id.localeCompare(b.id);
  });
}

function buildChromeLaunchArgs(
  info: ChromeRootInfo,
  mode: "headed" | "headless"
): string[] {
  const args = [
    `--user-data-dir=${info.chromeRoot}`,
    `--remote-debugging-port=${info.remoteDebuggingPort}`,
    "--no-first-run",
    "--no-default-browser-check",
  ];

  if (info.profileDirectory) {
    args.push(`--profile-directory=${info.profileDirectory}`);
  }

  if (mode === "headless") {
    args.push("--headless=new", "--disable-gpu");
  }

  args.push("about:blank");
  return args;
}

async function connectBrowserIfReady(
  state: BrowserInstanceState,
  timeoutMs: number
): Promise<PatchrightBrowserLike | null> {
  const port = Number(state.port);
  if (!Number.isInteger(port) || port <= 0) {
    return null;
  }

  // `tabs.*` scans instance state files; a single stale/unreachable port must not block the whole operation.
  if (!(await isCdpReady(port, 250))) {
    return null;
  }

  try {
    return await connectBrowser(port, timeoutMs);
  } catch {
    return null;
  }
}

async function connectBrowser(port: number, timeoutMs: number): Promise<PatchrightBrowserLike> {
  try {
    await waitForCdpReady(port, timeoutMs);
    const chromium = runtimeDeps.resolvePatchright();
    return await chromium.connectOverCDP(`http://${DEFAULT_CDP_HOST}:${port}`);
  } catch (error) {
    if (error instanceof BrowserCommandError) {
      throw error;
    }
    throw new BrowserCommandError(
      BROWSER_ERROR_CODES.RUNTIME_UNAVAILABLE,
      error instanceof Error ? error.message : String(error),
      { details: { port } }
    );
  }
}

async function getDefaultContext(browser: PatchrightBrowserLike): Promise<{
  pages(): Array<unknown>;
  newPage(): Promise<unknown>;
}> {
  const context = browser.contexts()[0];
  if (!context) {
    throw new BrowserCommandError(
      BROWSER_ERROR_CODES.RUNTIME_UNAVAILABLE,
      "Patchright browser context is unavailable"
    );
  }
  return context;
}

async function getPageTargetId(page: unknown): Promise<string> {
  const currentPage = page as {
    context(): { newCDPSession(page: unknown): Promise<{ send(method: string): Promise<Record<string, unknown>>; detach(): Promise<void> }> };
  };
  const session = await currentPage.context().newCDPSession(page);
  try {
    const info = asRecord(await session.send("Target.getTargetInfo"));
    const targetInfo = asRecord(info.targetInfo);
    const targetId = typeof targetInfo.targetId === "string" ? targetInfo.targetId.trim() : "";
    if (!targetId) {
      throw new BrowserCommandError(
        BROWSER_ERROR_CODES.RUNTIME_UNAVAILABLE,
        "unable to resolve targetId from CDP"
      );
    }
    return targetId;
  } finally {
    await session.detach().catch(() => undefined);
  }
}

async function listTabsForContext(context: {
  pages(): Array<unknown>;
}): Promise<BrowserTabSummary[]> {
  const tabs: BrowserTabSummary[] = [];
  for (const rawPage of context.pages()) {
    const page = rawPage as {
      title(): Promise<string>;
      url(): string;
    };
    tabs.push({
      id: await getPageTargetId(rawPage),
      title: await page.title().catch(() => ""),
      type: "page",
      url: page.url(),
    });
  }
  return tabs;
}

async function resolvePageByTabId(
  context: {
    pages(): Array<unknown>;
  },
  tabId: string
): Promise<unknown> {
  for (const rawPage of context.pages()) {
    if (await getPageTargetId(rawPage) === tabId) {
      return rawPage;
    }
  }
  throw new BrowserCommandError(
    BROWSER_ERROR_CODES.TAB_NOT_FOUND,
    `tab not found: ${tabId}`,
    { details: { tabId } }
  );
}

function serializeRef(ref: BrowserRefDescriptor): string {
  return JSON.stringify({
    role: ref.role,
    name: ref.name,
    index: ref.index,
  });
}

function parseRef(raw: string): BrowserRefDescriptor {
  try {
    const parsed = JSON.parse(raw) as BrowserRefDescriptor;
    if (!parsed || typeof parsed !== "object") {
      throw new Error("invalid ref payload");
    }
    if (typeof parsed.role !== "string" || typeof parsed.name !== "string" || !Number.isInteger(parsed.index)) {
      throw new Error("ref must include role/name/index");
    }
    return {
      role: parsed.role.trim(),
      name: parsed.name.trim(),
      index: parsed.index,
    };
  } catch (error) {
    throw new BrowserCommandError(
      BROWSER_ERROR_CODES.BAD_ARGS,
      error instanceof Error ? error.message : String(error),
      { details: { ref: raw } }
    );
  }
}

async function collectSnapshotRefs(page: unknown, interactiveOnly: boolean): Promise<SnapshotRefEntry[]> {
  const currentPage = page as {
    evaluate<R, A>(fn: (arg: A) => R, arg: A): Promise<R>;
  };

  const source = String.raw`(onlyInteractive) => {
    const doc = globalThis.document;
    const interactiveRoles = new Set([
      "button",
      "checkbox",
      "combobox",
      "link",
      "menuitem",
      "option",
      "radio",
      "switch",
      "tab",
      "textbox",
    ]);
    const counters = new Map();

    const normalizeText = (value) => (value || "").replace(/\s+/g, " ").trim();

    const getRole = (el) => {
      const explicitRole = normalizeText(el.getAttribute("role"));
      if (explicitRole) {
        return explicitRole.split(/\s+/)[0];
      }

      const tag = String(el.tagName || "").toLowerCase();
      if (tag === "a" && el.hasAttribute("href")) return "link";
      if (tag === "button") return "button";
      if (tag === "select") return "combobox";
      if (tag === "textarea") return "textbox";
      if (tag === "option") return "option";
      if (tag === "summary") return "button";
      if (tag === "input") {
        const type = normalizeText(el.type || "text").toLowerCase();
        if (type === "checkbox") return "checkbox";
        if (type === "radio") return "radio";
        if (type === "button" || type === "submit" || type === "reset") return "button";
        return "textbox";
      }
      return null;
    };

    const getLabelTextFromIds = (ids) => normalizeText(
      ids
        .split(/\s+/)
        .map((id) => doc.getElementById(id)?.textContent || "")
        .join(" ")
    );

    const getName = (el) => {
      const ariaLabel = normalizeText(el.getAttribute("aria-label"));
      if (ariaLabel) return ariaLabel;

      const labelledBy = normalizeText(el.getAttribute("aria-labelledby"));
      if (labelledBy) {
        const fromIds = getLabelTextFromIds(labelledBy);
        if (fromIds) return fromIds;
      }

      const tag = String(el.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") {
        const id = normalizeText(el.id);
        if (id) {
          const label = doc.querySelector("label[for=\"" + id.replace(/"/g, "\\\"") + "\"]");
          const fromLabel = normalizeText(label?.textContent);
          if (fromLabel) return fromLabel;
        }
      }

      const placeholder = normalizeText(el.placeholder);
      if (placeholder) return placeholder;

      const title = normalizeText(el.getAttribute("title"));
      if (title) return title;

      const alt = normalizeText(el.getAttribute("alt"));
      if (alt) return alt;

      if (tag === "input") {
        const value = normalizeText(el.value);
        if (value) return value;
      }

      return normalizeText(el.textContent).slice(0, 160);
    };

    const isVisible = (el) => {
      const style = globalThis.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") {
        return false;
      }
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    const refs = [];

    for (const el of Array.from(doc.querySelectorAll("body *"))) {
      if (!el || !isVisible(el)) {
        continue;
      }

      const role = getRole(el);
      if (!role) {
        continue;
      }
      if (onlyInteractive && !interactiveRoles.has(role)) {
        continue;
      }

      const name = getName(el);
      if (!name) {
        continue;
      }

      const key = role + "::" + name;
      const index = counters.get(key) ?? 0;
      counters.set(key, index + 1);

      refs.push({
        role,
        name,
        index,
        ref: JSON.stringify({ role, name, index }),
        tag: String(el.tagName || "").toLowerCase(),
        text: normalizeText(el.innerText || el.textContent || "").slice(0, 160),
      });
    }

    return refs;
  }`;

  return await currentPage.evaluate(
    ({ script, onlyInteractive }) => {
      const fn = (0, eval)(script) as (interactiveOnly: boolean) => SnapshotRefEntry[];
      return fn(onlyInteractive);
    },
    { script: source, onlyInteractive: interactiveOnly }
  );
}

function renderSnapshotOutput(ariaSnapshot: string, refs: SnapshotRefEntry[], compact: boolean): string {
  const lines: string[] = [];
  const trimmedSnapshot = ariaSnapshot.trim();

  if (trimmedSnapshot) {
    lines.push(trimmedSnapshot);
  }

  const renderedRefs = refs.map((entry) => {
    const parts = [entry.ref];
    if (!compact) {
      parts.push(`role=${entry.role}`);
      parts.push(`name=${entry.name}`);
      if (entry.text) {
        parts.push(`text=${entry.text}`);
      }
    }
    return parts.join(" | ");
  });

  if (renderedRefs.length > 0) {
    lines.push(compact ? "[refs]" : "[interactive-refs]");
    lines.push(...renderedRefs);
  }

  return lines.join("\n");
}

async function resolveLocatorForRef(page: unknown, ref: BrowserRefDescriptor): Promise<{
  click(): Promise<void>;
  fill(value: string): Promise<void>;
  press(key: string): Promise<void>;
  count(): Promise<number>;
}> {
  const currentPage = page as {
    getByRole(
      role: string,
      options: { name: string }
    ): {
      nth(index: number): {
        click(): Promise<void>;
        fill(value: string): Promise<void>;
        press(key: string): Promise<void>;
      };
      count(): Promise<number>;
    };
  };

  const locator = currentPage.getByRole(ref.role, { name: ref.name });
  const count = await locator.count();
  if (count <= ref.index) {
    throw new BrowserCommandError(
      BROWSER_ERROR_CODES.REF_NOT_FOUND,
      `ref not found: ${serializeRef(ref)}`,
      { details: { ref, count } }
    );
  }

  return {
    count: async () => count,
    click: async () => await locator.nth(ref.index).click(),
    fill: async (value: string) => await locator.nth(ref.index).fill(value),
    press: async (key: string) => await locator.nth(ref.index).press(key),
  };
}

async function resolveInstanceIdForTabsOpen(
  input: BrowserOperationInput
): Promise<{ instanceId: string; autoLaunched: boolean }> {
  if (typeof input.instanceId === "string" && input.instanceId.trim()) {
    return { instanceId: input.instanceId.trim(), autoLaunched: false };
  }

  const launched = await executeBrowserOperation({
    operation: "instances.launch",
    mode: input.mode ?? "headless",
    rootName: resolveRootName(input),
    port: input.port,
    timeoutMs: input.timeoutMs,
  });

  return {
    instanceId: requireNonEmptyString(launched.data.id, "instanceId"),
    autoLaunched: true,
  };
}

async function launchChromeInstance(input: BrowserOperationInput): Promise<BrowserInstanceState> {
  const mode = normalizeMode(input.mode ?? "headless");
  const rootName = resolveRootName(input);
  const requestedPort = input.port !== undefined ? normalizePort(input.port) : undefined;
  const chrome = await ensureChromeRoot({
    name: rootName,
    ...(requestedPort ? { port: requestedPort } : {}),
  });
  const instanceId = buildInstanceId(rootName, chrome.remoteDebuggingPort);

  if (await isCdpReady(chrome.remoteDebuggingPort, 1_500)) {
    const existingState = await loadInstanceState(instanceId);
    const resumedState: BrowserInstanceState = existingState ?? {
      id: instanceId,
      rootName,
      chromeRoot: chrome.chromeRoot,
      port: String(chrome.remoteDebuggingPort),
      headless: mode === "headless",
      status: "running",
      mode,
      startTime: new Date().toISOString(),
    };
    await saveInstanceState(resumedState);
    return resumedState;
  }

  const child = runtimeDeps.spawnProcess(
    getChromeBinaryPath(),
    buildChromeLaunchArgs(chrome, mode),
    {
      detached: true,
      stdio: "ignore",
      env: process.env,
      shell: false,
    }
  );
  child.unref();

  await waitForCdpReady(chrome.remoteDebuggingPort, getTimeoutMs(input));

  const state: BrowserInstanceState = {
    id: instanceId,
    rootName,
    chromeRoot: chrome.chromeRoot,
    port: String(chrome.remoteDebuggingPort),
    headless: mode === "headless",
    status: "running",
    pid: child.pid,
    mode,
    startTime: new Date().toISOString(),
  };
  await saveInstanceState(state);
  return state;
}

async function listProfiles(): Promise<BrowserProfile[]> {
  const profilesRoot = getChromeProfilesRoot();
  await mkdir(profilesRoot, { recursive: true });
  const entries = await readdir(profilesRoot, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => ({
      id: entry.name,
      rootName: entry.name,
      path: join(profilesRoot, entry.name),
      pathExists: true,
    }))
    .sort((a, b) => a.rootName.localeCompare(b.rootName));
}

async function stopInstance(instanceId: string): Promise<Record<string, unknown>> {
  const parsed = parseInstanceId(instanceId);
  const state = await loadInstanceState(instanceId);
  if (!state && !(await isCdpReady(parsed.port, 1_500))) {
    throw new BrowserCommandError(
      BROWSER_ERROR_CODES.INSTANCE_NOT_FOUND,
      `instance not found: ${instanceId}`,
      { details: { instanceId } }
    );
  }

  if (state?.pid && processExists(state.pid)) {
    process.kill(state.pid, "SIGTERM");
    for (let i = 0; i < 20; i++) {
      if (!processExists(state.pid)) {
        break;
      }
      await sleep(150);
    }
    if (processExists(state.pid)) {
      process.kill(state.pid, "SIGKILL");
    }
  }

  await removeInstanceState(parsed.rootName, parsed.port);

  return {
    id: instanceId,
    status: "stopped",
  };
}

export async function executeBrowserOperation(
  input: BrowserOperationInput
): Promise<BrowserOperationResult> {
  switch (input.operation) {
    case "health": {
      const instances = await listInstanceStates();
      return {
        operation: input.operation,
        data: {
          status: "ok",
          transport: "connectOverCDP",
          runtime: "patchright",
          instances: instances.length,
        },
      };
    }
    case "profiles.list": {
      return {
        operation: input.operation,
        data: {
          profiles: await listProfiles(),
        },
      };
    }
    case "instances.list": {
      const states = await listInstanceStates();
      const running: BrowserInstanceState[] = [];
      for (const state of states) {
        if (await isCdpReady(Number(state.port), 1_500)) {
          running.push({
            ...state,
            status: "running",
          });
        }
      }
      return {
        operation: input.operation,
        data: {
          instances: running,
        },
      };
    }
    case "instances.launch": {
      const state = await launchChromeInstance(input);
      return {
        operation: input.operation,
        data: { ...state },
      };
    }
    case "instances.stop": {
      const instanceId = requireNonEmptyString(input.instanceId, "instanceId");
      return {
        operation: input.operation,
        data: await stopInstance(instanceId),
      };
    }
    case "tabs.open": {
      const { instanceId, autoLaunched } = await resolveInstanceIdForTabsOpen(input);
      const { port } = parseInstanceId(instanceId);
      const browser = await connectBrowser(port, getTimeoutMs(input));
      try {
        const context = await getDefaultContext(browser);
        const page = (await context.newPage()) as {
          goto(url: string, options: { waitUntil: "domcontentloaded"; timeout: number }): Promise<void>;
          title(): Promise<string>;
          url(): string;
        };
        const url = requireNonEmptyString(input.url, "url");
        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: getTimeoutMs(input),
        });
        const tabId = await getPageTargetId(page);
        return {
          operation: input.operation,
          data: {
            tabId,
            title: await page.title().catch(() => ""),
            url: page.url(),
            instanceId,
            autoLaunched,
          },
        };
      } finally {
        await browser.close().catch(() => undefined);
      }
    }
    case "tabs.list": {
      const { port } = parseInstanceId(requireNonEmptyString(input.instanceId, "instanceId"));
      const browser = await connectBrowser(port, getTimeoutMs(input));
      try {
        const context = await getDefaultContext(browser);
        return {
          operation: input.operation,
          data: {
            tabs: await listTabsForContext(context),
          },
        };
      } finally {
        await browser.close().catch(() => undefined);
      }
    }
    case "tabs.snapshot": {
      const tabId = requireNonEmptyString(input.tabId, "tabId");
      const states = await listInstanceStates();
      for (const state of states) {
        const browser = await connectBrowserIfReady(state, getTimeoutMs(input));
        if (!browser) {
          continue;
        }
        try {
          const context = await getDefaultContext(browser);
          const page = await resolvePageByTabId(context, tabId).catch(() => null);
          if (!page) {
            continue;
          }
          const currentPage = page as {
            locator(selector: string): { ariaSnapshot(): Promise<string> };
          };
          const refs = await collectSnapshotRefs(page, !!input.interactive);
          const ariaSnapshot = await currentPage.locator("body").ariaSnapshot();
          return {
            operation: input.operation,
            data: {
              tabId,
              snapshot: renderSnapshotOutput(ariaSnapshot, refs, !!input.compact),
              refs,
              interactive: !!input.interactive,
              compact: !!input.compact,
            },
          };
        } finally {
          await browser.close().catch(() => undefined);
        }
      }
      throw new BrowserCommandError(
        BROWSER_ERROR_CODES.TAB_NOT_FOUND,
        `tab not found: ${tabId}`,
        { details: { tabId } }
      );
    }
    case "tabs.text": {
      const tabId = requireNonEmptyString(input.tabId, "tabId");
      const states = await listInstanceStates();
      for (const state of states) {
        const browser = await connectBrowserIfReady(state, getTimeoutMs(input));
        if (!browser) {
          continue;
        }
        try {
          const context = await getDefaultContext(browser);
          const page = await resolvePageByTabId(context, tabId).catch(() => null);
          if (!page) {
            continue;
          }
          const currentPage = page as {
            title(): Promise<string>;
            url(): string;
            locator(selector: string): { innerText(): Promise<string> };
          };
          return {
            operation: input.operation,
            data: {
              title: await currentPage.title().catch(() => ""),
              url: currentPage.url(),
              text: await currentPage.locator("body").innerText(),
            },
          };
        } finally {
          await browser.close().catch(() => undefined);
        }
      }
      throw new BrowserCommandError(
        BROWSER_ERROR_CODES.TAB_NOT_FOUND,
        `tab not found: ${tabId}`,
        { details: { tabId } }
      );
    }
    case "tabs.action": {
      const tabId = requireNonEmptyString(input.tabId, "tabId");
      const kind = requireNonEmptyString(input.kind, "kind");
      const states = await listInstanceStates();
      for (const state of states) {
        const browser = await connectBrowserIfReady(state, getTimeoutMs(input));
        if (!browser) {
          continue;
        }
        try {
          const context = await getDefaultContext(browser);
          const page = await resolvePageByTabId(context, tabId).catch(() => null);
          if (!page) {
            continue;
          }
          const ref = input.ref ? parseRef(input.ref) : null;
          switch (kind) {
            case "click": {
              if (!ref) {
                throw new BrowserCommandError(
                  BROWSER_ERROR_CODES.BAD_ARGS,
                  "tabs.action click requires ref"
                );
              }
              const locator = await resolveLocatorForRef(page, ref);
              await locator.click();
              return {
                operation: input.operation,
                data: {
                  success: true,
                  kind,
                  ref: serializeRef(ref),
                },
              };
            }
            case "type": {
              if (!ref) {
                throw new BrowserCommandError(
                  BROWSER_ERROR_CODES.BAD_ARGS,
                  "tabs.action type requires ref"
                );
              }
              const text = typeof input.text === "string" ? input.text : "";
              const locator = await resolveLocatorForRef(page, ref);
              await locator.fill(text);
              return {
                operation: input.operation,
                data: {
                  success: true,
                  kind,
                  ref: serializeRef(ref),
                  textLength: text.length,
                },
              };
            }
            case "press": {
              const key = requireNonEmptyString(input.key, "key");
              if (ref) {
                const locator = await resolveLocatorForRef(page, ref);
                await locator.press(key);
              } else {
                const currentPage = page as { keyboard: { press(key: string): Promise<void> } };
                await currentPage.keyboard.press(key);
              }
              return {
                operation: input.operation,
                data: {
                  success: true,
                  kind,
                  ...(ref ? { ref: serializeRef(ref) } : {}),
                  key,
                },
              };
            }
            default:
              throw new BrowserCommandError(
                BROWSER_ERROR_CODES.BAD_ARGS,
                `unsupported action kind: ${kind}`
              );
          }
        } finally {
          await browser.close().catch(() => undefined);
        }
      }
      throw new BrowserCommandError(
        BROWSER_ERROR_CODES.TAB_NOT_FOUND,
        `tab not found: ${tabId}`,
        { details: { tabId } }
      );
    }
    case "tabs.eval": {
      const tabId = requireNonEmptyString(input.tabId, "tabId");
      const expression = requireNonEmptyString(input.expression, "expression");
      const states = await listInstanceStates();
      for (const state of states) {
        const browser = await connectBrowserIfReady(state, getTimeoutMs(input));
        if (!browser) {
          continue;
        }
        try {
          const context = await getDefaultContext(browser);
          const page = await resolvePageByTabId(context, tabId).catch(() => null);
          if (!page) {
            continue;
          }
          const currentPage = page as {
            evaluate<R, A>(fn: (arg: A) => R, arg: A): Promise<R>;
          };
          const result = await currentPage.evaluate((source) => (0, eval)(source), expression);
          return {
            operation: input.operation,
            data: {
              result,
            },
          };
        } finally {
          await browser.close().catch(() => undefined);
        }
      }
      throw new BrowserCommandError(
        BROWSER_ERROR_CODES.TAB_NOT_FOUND,
        `tab not found: ${tabId}`,
        { details: { tabId } }
      );
    }
    default:
      throw new BrowserCommandError(
        BROWSER_ERROR_CODES.BAD_ARGS,
        `unsupported browser operation: ${(input as { operation?: string }).operation ?? "unknown"}`
      );
  }
}
