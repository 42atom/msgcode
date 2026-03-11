/**
 * RETIRED / HISTORICAL / ROLLBACK ONLY
 * 当前正式浏览器主链已切到 browser-patchright.ts。
 * 本文件保留仅作历史参考与回滚锚点，不得重新接回正式运行时。
 *
 * msgcode: PinchTab Browser Core Runner
 *
 * 约束：
 * - 只接 PinchTab HTTP API
 * - 不猜默认 instance/tab
 * - 调用方必须显式提供 instanceId/tabId
 */

import {
  ensurePinchtabReady,
  getPinchtabBaseUrl,
  getPinchtabHeaders,
} from "../browser/pinchtab-runtime.js";

const DEFAULT_TIMEOUT_MS = 30000;

export const BROWSER_ERROR_CODES = {
  OK: "OK",
  BAD_ARGS: "BROWSER_BAD_ARGS",
  AUTH_FAILED: "BROWSER_AUTH_FAILED",
  HTTP_ERROR: "BROWSER_HTTP_ERROR",
  INSTANCE_NOT_FOUND: "BROWSER_INSTANCE_NOT_FOUND",
  ORCHESTRATOR_URL_REQUIRED: "BROWSER_ORCHESTRATOR_URL_REQUIRED",
  PINCHTAB_UNAVAILABLE: "BROWSER_PINCHTAB_UNAVAILABLE",
  PROFILE_BUSY: "BROWSER_PROFILE_BUSY",
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

export interface PinchtabHealth {
  status: string;
  mode?: string;
  tabs?: number;
  cdp?: string;
}

export interface PinchtabProfile {
  id?: string;
  name?: string;
  useWhen?: string;
  importFrom?: string;
  [key: string]: unknown;
}

export interface PinchtabInstance {
  id: string;
  profileId: string;
  profileName: string;
  port: string;
  headless: boolean;
  status: string;
  startTime?: string;
  [key: string]: unknown;
}

export interface PinchtabTabSummary {
  id: string;
  title: string;
  type?: string;
  url: string;
  [key: string]: unknown;
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

interface RequestOptions {
  method?: "GET" | "POST";
  query?: Record<string, string | undefined>;
  body?: Record<string, unknown>;
  responseType?: "json" | "text";
  timeoutMs?: number;
}

const ORCHESTRATOR_ONLY_OPERATIONS = new Set<BrowserOperation>([
  "profiles.list",
  "instances.list",
  "instances.launch",
  "instances.stop",
  "tabs.open",
  "tabs.list",
]);

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as { name?: unknown };
  return candidate.name === "AbortError";
}

function normalizeErrorPayload(raw: string): { message: string; details?: Record<string, unknown> } {
  if (!raw.trim()) {
    return { message: "empty response body" };
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const error = typeof parsed.error === "string"
      ? parsed.error
      : (typeof parsed.message === "string" ? parsed.message : raw);
    return { message: error, details: parsed };
  } catch {
    return { message: raw };
  }
}

function classifyBrowserError(
  status: number | undefined,
  message: string,
  details?: Record<string, unknown>
): BrowserCommandError {
  const lowered = message.toLowerCase();

  if (status === 401 || status === 403) {
    return new BrowserCommandError(BROWSER_ERROR_CODES.AUTH_FAILED, message, { status, details });
  }
  if (lowered.includes("tab ") && lowered.includes("not found")) {
    return new BrowserCommandError(BROWSER_ERROR_CODES.TAB_NOT_FOUND, message, { status, details });
  }
  if (lowered.includes("instance ") && lowered.includes("not found")) {
    return new BrowserCommandError(BROWSER_ERROR_CODES.INSTANCE_NOT_FOUND, message, { status, details });
  }
  if (lowered.includes("already has an active instance")) {
    return new BrowserCommandError(BROWSER_ERROR_CODES.PROFILE_BUSY, message, { status, details });
  }

  return new BrowserCommandError(BROWSER_ERROR_CODES.HTTP_ERROR, message, { status, details });
}

async function requestPinchtab<T = unknown>(
  path: string,
  options: RequestOptions = {}
): Promise<T | string> {
  const {
    method = "GET",
    query,
    body,
    responseType = "json",
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  const url = new URL(path, `${getPinchtabBaseUrl()}/`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.set(key, value);
      }
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method,
      headers: {
        ...getPinchtabHeaders(),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    if (!response.ok) {
      const raw = await response.text();
      const normalized = normalizeErrorPayload(raw);
      throw classifyBrowserError(response.status, normalized.message, normalized.details);
    }

    if (responseType === "text") {
      return await response.text();
    }

    return await response.json() as T;
  } catch (error) {
    if (error instanceof BrowserCommandError) {
      throw error;
    }

    if (isAbortError(error)) {
      throw new BrowserCommandError(
        BROWSER_ERROR_CODES.TIMEOUT,
        `request timed out after ${timeoutMs}ms`,
        { details: { path, method, timeoutMs, baseUrl: getPinchtabBaseUrl() } }
      );
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new BrowserCommandError(
      BROWSER_ERROR_CODES.PINCHTAB_UNAVAILABLE,
      message,
      { details: { path, method, baseUrl: getPinchtabBaseUrl() } }
    );
  } finally {
    clearTimeout(timer);
  }
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

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

/**
 * 对“打开网页”做最小 happy path 桥接：
 * - 若调用方已显式提供 instanceId，则保持原协议
 * - 若未提供，则自动拉起一个默认实例，再继续 open
 */
async function resolveInstanceIdForTabsOpen(
  input: BrowserOperationInput
): Promise<{ instanceId: string; autoLaunched: boolean }> {
  if (typeof input.instanceId === "string" && input.instanceId.trim()) {
    return { instanceId: input.instanceId.trim(), autoLaunched: false };
  }

  const mode = normalizeMode(input.mode ?? "headless");
  const body: Record<string, unknown> = { mode };
  if (typeof input.profileId === "string" && input.profileId.trim()) {
    const requestedProfileId = input.profileId.trim();
    const profiles = await requestPinchtab<PinchtabProfile[]>("/profiles", {
      timeoutMs: input.timeoutMs,
    });
    const profileList = Array.isArray(profiles) ? profiles : [];
    const profileExists = profileList.some((profile) => {
      const id = typeof profile?.id === "string" ? profile.id.trim() : "";
      return id === requestedProfileId;
    });
    if (profileExists) {
      body.profileId = requestedProfileId;
    }
  }
  if (input.port !== undefined && String(input.port).trim()) {
    body.port = String(input.port).trim();
  }

  const launched = await requestPinchtab<PinchtabInstance>("/instances/launch", {
    method: "POST",
    body,
    timeoutMs: input.timeoutMs,
  });
  const instanceId = requireNonEmptyString(asRecord(launched).id, "instanceId");
  return { instanceId, autoLaunched: true };
}

async function ensureOrchestratorBaseUrl(timeoutMs?: number): Promise<void> {
  try {
    await ensurePinchtabReady({ timeoutMs });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      const code = String((error as { code?: unknown }).code || "");
      const message = error instanceof Error ? error.message : String(error);
      if (code === "PINCHTAB_ORCHESTRATOR_URL_REQUIRED") {
        throw new BrowserCommandError(
          BROWSER_ERROR_CODES.ORCHESTRATOR_URL_REQUIRED,
          `${message}; instance URLs are not supported for this operation`,
          {
            details: {
              baseUrl: getPinchtabBaseUrl(),
            },
          }
        );
      }
      if (code === "PINCHTAB_HEALTH_TIMEOUT" || code === "PINCHTAB_BOOT_TIMEOUT") {
        throw new BrowserCommandError(
          BROWSER_ERROR_CODES.TIMEOUT,
          message,
          { details: { baseUrl: getPinchtabBaseUrl() } }
        );
      }
      throw new BrowserCommandError(
        BROWSER_ERROR_CODES.PINCHTAB_UNAVAILABLE,
        message,
        { details: { baseUrl: getPinchtabBaseUrl() } }
      );
    }
    throw error;
  }
}

export async function executeBrowserOperation(
  input: BrowserOperationInput
): Promise<BrowserOperationResult> {
  if (ORCHESTRATOR_ONLY_OPERATIONS.has(input.operation)) {
    await ensureOrchestratorBaseUrl(input.timeoutMs);
  }

  switch (input.operation) {
    case "health": {
      const health = await requestPinchtab<PinchtabHealth>("/health");
      return {
        operation: input.operation,
        data: asRecord(health),
      };
    }
    case "profiles.list": {
      const profiles = await requestPinchtab<PinchtabProfile[]>("/profiles");
      return {
        operation: input.operation,
        data: { profiles: Array.isArray(profiles) ? profiles : [] },
      };
    }
    case "instances.list": {
      const instances = await requestPinchtab<PinchtabInstance[]>("/instances");
      return {
        operation: input.operation,
        data: { instances: Array.isArray(instances) ? instances : [] },
      };
    }
    case "instances.launch": {
      const mode = normalizeMode(input.mode ?? "headless");
      const body: Record<string, unknown> = { mode };
      if (input.profileId) {
        body.profileId = input.profileId;
      }
      if (input.port !== undefined && String(input.port).trim()) {
        body.port = String(input.port).trim();
      }
      const launched = await requestPinchtab<PinchtabInstance>("/instances/launch", {
        method: "POST",
        body,
        timeoutMs: input.timeoutMs,
      });
      return {
        operation: input.operation,
        data: asRecord(launched),
      };
    }
    case "instances.stop": {
      const instanceId = requireNonEmptyString(input.instanceId, "instanceId");
      const stopped = await requestPinchtab<Record<string, unknown>>(
        `/instances/${instanceId}/stop`,
        {
          method: "POST",
          body: {},
          timeoutMs: input.timeoutMs,
        }
      );
      return {
        operation: input.operation,
        data: asRecord(stopped),
      };
    }
    case "tabs.open": {
      const { instanceId, autoLaunched } = await resolveInstanceIdForTabsOpen(input);
      const url = requireNonEmptyString(input.url, "url");
      const opened = await requestPinchtab<Record<string, unknown>>(
        `/instances/${instanceId}/tabs/open`,
        {
          method: "POST",
          body: { url },
          timeoutMs: input.timeoutMs,
        }
      );
      return {
        operation: input.operation,
        data: {
          ...asRecord(opened),
          instanceId,
          autoLaunched,
        },
      };
    }
    case "tabs.list": {
      const instanceId = requireNonEmptyString(input.instanceId, "instanceId");
      const listed = await requestPinchtab<{ tabs?: PinchtabTabSummary[] }>(
        `/instances/${instanceId}/tabs`,
        {
          timeoutMs: input.timeoutMs,
        }
      ) as { tabs?: PinchtabTabSummary[] };
      return {
        operation: input.operation,
        data: {
          tabs: Array.isArray(listed.tabs) ? listed.tabs : [],
        },
      };
    }
    case "tabs.snapshot": {
      const tabId = requireNonEmptyString(input.tabId, "tabId");
      const snapshot = await requestPinchtab<string>(
        `/tabs/${tabId}/snapshot`,
        {
          query: {
            ...(input.interactive ? { filter: "interactive" } : {}),
            format: input.compact ? "compact" : "full",
          },
          responseType: "text",
          timeoutMs: input.timeoutMs,
        }
      );
      return {
        operation: input.operation,
        data: {
          tabId,
          snapshot,
          interactive: !!input.interactive,
          compact: !!input.compact,
        },
      };
    }
    case "tabs.text": {
      const tabId = requireNonEmptyString(input.tabId, "tabId");
      const textResult = await requestPinchtab<Record<string, unknown>>(
        `/tabs/${tabId}/text`,
        {
          timeoutMs: input.timeoutMs,
        }
      );
      return {
        operation: input.operation,
        data: asRecord(textResult),
      };
    }
    case "tabs.action": {
      const tabId = requireNonEmptyString(input.tabId, "tabId");
      const kind = requireNonEmptyString(input.kind, "kind");
      const body: Record<string, unknown> = { kind };
      if (typeof input.ref === "string" && input.ref.trim()) {
        body.ref = input.ref.trim();
      }
      if (typeof input.text === "string") {
        body.text = input.text;
      }
      if (typeof input.key === "string" && input.key.trim()) {
        body.key = input.key.trim();
      }
      const actionResult = await requestPinchtab<Record<string, unknown>>(
        `/tabs/${tabId}/action`,
        {
          method: "POST",
          body,
          timeoutMs: input.timeoutMs,
        }
      );
      return {
        operation: input.operation,
        data: asRecord(actionResult),
      };
    }
    case "tabs.eval": {
      const tabId = requireNonEmptyString(input.tabId, "tabId");
      const expression = requireNonEmptyString(input.expression, "expression");
      const evalResult = await requestPinchtab<Record<string, unknown>>(
        `/tabs/${tabId}/evaluate`,
        {
          method: "POST",
          body: { expression },
          timeoutMs: input.timeoutMs,
        }
      );
      return {
        operation: input.operation,
        data: asRecord(evalResult),
      };
    }
    default:
      throw new BrowserCommandError(
        BROWSER_ERROR_CODES.BAD_ARGS,
        `unsupported browser operation: ${(input as { operation?: string }).operation ?? "unknown"}`
      );
  }
}
