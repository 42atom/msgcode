import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { watch, type FSWatcher } from "node:fs";
import { resolveRuntimeEntry } from "../runtime/runtime-entry.js";
import {
  buildThreadSurfaceCliArgs,
  getSendThreadInputChannel,
  getThreadSurfaceReadChannel,
  getThreadUpdateChannel,
  type ThreadSurfaceRunCommandRequest,
  type SendThreadInputRequest,
} from "./thread-surface-bridge.js";
import {
  sendThreadInput as sendThreadInputFromRuntime,
  type PersistedThreadInput,
} from "../runtime/thread-input.js";

export interface ElectronRuntimePaths {
  preloadPath: string;
  rendererEntryUrl: string;
}

export function resolveElectronRuntimePaths(entryModuleUrl: string): ElectronRuntimePaths {
  const runtimeDir = path.dirname(fileURLToPath(entryModuleUrl));
  return {
    preloadPath: path.join(runtimeDir, "preload.js"),
    rendererEntryUrl: pathToFileURL(path.join(runtimeDir, "renderer.js")).toString(),
  };
}

export function buildRendererHtml(rendererEntryUrl: string): string {
  return [
    "<!doctype html>",
    '<html lang="zh-CN">',
    "  <head>",
    '    <meta charset="utf-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1" />',
    "    <title>msgcode main window</title>",
    "  </head>",
    "  <body>",
    '    <div id="app-root"></div>',
    `    <script type="module" src="${rendererEntryUrl}"></script>`,
    "  </body>",
    "</html>",
    "",
  ].join("\n");
}

export function buildThreadSurfaceCliCommand(
  request: ThreadSurfaceRunCommandRequest,
  options?: { env?: NodeJS.ProcessEnv; nodePath?: string },
): { command: string; args: string[]; cwd: string } {
  const runtimeEntry = resolveRuntimeEntry("cli", {
    env: options?.env,
    nodePath: options?.nodePath,
  });
  return {
    command: runtimeEntry.command,
    args: [...runtimeEntry.args, ...buildThreadSurfaceCliArgs(request)],
    cwd: runtimeEntry.workingDirectory,
  };
}

export function buildSendThreadInputCliCommand(
  request: SendThreadInputRequest,
  options?: { env?: NodeJS.ProcessEnv; nodePath?: string },
): { command: string; args: string[]; cwd: string } {
  const runtimeEntry = resolveRuntimeEntry("cli", {
    env: options?.env,
    nodePath: options?.nodePath,
  });
  return {
    command: runtimeEntry.command,
    args: [
      ...runtimeEntry.args,
      "appliance",
      "thread-input-run",
      "--workspace",
      request.workspacePath,
      "--thread-id",
      request.threadId,
      "--text",
      request.text,
    ],
    cwd: runtimeEntry.workingDirectory,
  };
}

interface DetachedThreadInputChildLike {
  unref(): void;
  once?(
    event: "close" | "error",
    listener: (...args: unknown[]) => void,
  ): DetachedThreadInputChildLike;
}

interface RunSendThreadInputDeps {
  persistUserTurn?: (request: SendThreadInputRequest) => Promise<PersistedThreadInput | void>;
  spawnChild?: (
    command: string,
    args: string[],
    options: {
      cwd: string;
      env: NodeJS.ProcessEnv;
      stdio: "ignore";
      detached: true;
    },
  ) => DetachedThreadInputChildLike;
  afterSpawn?: (
    child: DetachedThreadInputChildLike,
    request: SendThreadInputRequest,
    persisted: PersistedThreadInput | null,
  ) => void;
  env?: NodeJS.ProcessEnv;
  nodePath?: string;
}

interface ThreadUpdatePushDeps {
  notify?: (payload: ThreadUpdateEventPayload) => void;
  watchFile?: (
    filePath: string,
    listener: (eventType: string) => void,
  ) => { close(): void };
}

interface ThreadUpdateEventPayload {
  workspacePath: string;
  threadId: string;
}

interface ThreadUpdateWindowLike {
  webContents: {
    send(channel: string, payload: ThreadUpdateEventPayload): void;
  };
}

export function bindThreadUpdatePush(
  child: DetachedThreadInputChildLike,
  persisted: PersistedThreadInput,
  deps: ThreadUpdatePushDeps = {},
): void {
  const notify = deps.notify ?? (() => {});
  const watchFile =
    deps.watchFile ??
    ((filePath: string, listener: (eventType: string) => void): FSWatcher =>
      watch(filePath, (eventType) => {
        listener(eventType);
      }));

  const notifyThreadUpdated = (): void => {
    notify({
      workspacePath: persisted.workspacePath,
      threadId: persisted.threadId,
    });
  };

  let watcher: { close(): void } | null = null;
  try {
    watcher = watchFile(persisted.threadFilePath, (eventType) => {
      if (eventType !== "change" && eventType !== "rename") {
        return;
      }
      notifyThreadUpdated();
    });
  } catch {
    child.once?.("close", notifyThreadUpdated);
    child.once?.("error", notifyThreadUpdated);
    return;
  }

  const closeWatcher = (): void => {
    watcher?.close();
    notifyThreadUpdated();
  };

  child.once?.("close", closeWatcher);
  child.once?.("error", closeWatcher);
}

function notifyThreadUpdatedWindows(
  windows: readonly ThreadUpdateWindowLike[],
  payload: ThreadUpdateEventPayload,
): void {
  for (const window of windows) {
    window.webContents.send(getThreadUpdateChannel(), payload);
  }
}

function bindThreadUpdateNotifications(
  child: DetachedThreadInputChildLike,
  request: SendThreadInputRequest,
  persisted: PersistedThreadInput | null,
  notify: (payload: ThreadUpdateEventPayload) => void,
): void {
  if (persisted?.threadFilePath) {
    bindThreadUpdatePush(child, persisted, { notify });
    return;
  }

  const fallbackNotify = (): void => {
    notify({
      workspacePath: request.workspacePath,
      threadId: request.threadId,
    });
  };
  child.once?.("close", fallbackNotify);
  child.once?.("error", fallbackNotify);
}

export async function runThreadSurfaceCommand(
  request: ThreadSurfaceRunCommandRequest,
  options?: { env?: NodeJS.ProcessEnv; nodePath?: string },
): Promise<unknown> {
  const command = buildThreadSurfaceCliCommand(request, options);

  return await new Promise((resolve, reject) => {
    const child = spawn(command.command, command.args, {
      cwd: command.cwd,
      env: options?.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `Thread surface bridge command failed: ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(error);
      }
    });
  });
}

export async function runSendThreadInput(
  request: SendThreadInputRequest,
  deps: RunSendThreadInputDeps = {},
): Promise<void> {
  const persistUserTurn = deps.persistUserTurn ?? sendThreadInputFromRuntime;
  const spawnChild =
    deps.spawnChild ??
    ((command, args, options) => spawn(command, args, options));

  const persisted = (await persistUserTurn(request)) ?? null;
  const command = buildSendThreadInputCliCommand(request, {
    env: deps.env,
    nodePath: deps.nodePath,
  });
  const child = spawnChild(command.command, command.args, {
    cwd: command.cwd,
    env: deps.env ?? process.env,
    stdio: "ignore",
    detached: true,
  });
  deps.afterSpawn?.(child, request, persisted);
  child.unref();
}

export async function createMainWindow(entryModuleUrl = import.meta.url) {
  const { BrowserWindow } = await import("electron");
  const { preloadPath, rendererEntryUrl } = resolveElectronRuntimePaths(entryModuleUrl);
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const html = buildRendererHtml(rendererEntryUrl);
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  window.once("ready-to-show", () => {
    window.show();
  });
  return window;
}

export async function startElectronRuntime(entryModuleUrl = import.meta.url): Promise<void> {
  const { app, BrowserWindow, ipcMain } = await import("electron");

  const openWindow = async (): Promise<void> => {
    const allWindows = BrowserWindow.getAllWindows();
    if (allWindows.length > 0) {
      allWindows[0]?.focus();
      return;
    }
    await createMainWindow(entryModuleUrl);
  };

  await app.whenReady();
  ipcMain.handle(getThreadSurfaceReadChannel(), async (_event, request: ThreadSurfaceRunCommandRequest) => {
    return await runThreadSurfaceCommand(request);
  });
  ipcMain.handle(getSendThreadInputChannel(), async (_event, request: SendThreadInputRequest) => {
    const notify = (payload: ThreadUpdateEventPayload): void => {
      notifyThreadUpdatedWindows(BrowserWindow.getAllWindows(), payload);
    };
    await runSendThreadInput(request, {
      afterSpawn(child, nextRequest, persisted) {
        bindThreadUpdateNotifications(child, nextRequest, persisted, notify);
      },
    });
  });
  await openWindow();

  app.on("activate", () => {
    void openWindow();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}

if (typeof process.versions.electron === "string" && process.argv[1]?.endsWith("main.js")) {
  void startElectronRuntime();
}
