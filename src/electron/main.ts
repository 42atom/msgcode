import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { resolveRuntimeEntry } from "../runtime/runtime-entry.js";
import {
  buildReadonlySurfaceCliArgs,
  getReadonlySurfaceChannel,
  type ReadonlySurfaceRunCommandRequest,
} from "./readonly-surface-bridge.js";

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

export function buildReadonlySurfaceCliCommand(
  request: ReadonlySurfaceRunCommandRequest,
  options?: { env?: NodeJS.ProcessEnv; nodePath?: string },
): { command: string; args: string[]; cwd: string } {
  const runtimeEntry = resolveRuntimeEntry("cli", {
    env: options?.env,
    nodePath: options?.nodePath,
  });
  return {
    command: runtimeEntry.command,
    args: [...runtimeEntry.args, ...buildReadonlySurfaceCliArgs(request)],
    cwd: runtimeEntry.workingDirectory,
  };
}

export async function runReadonlySurfaceCommand(
  request: ReadonlySurfaceRunCommandRequest,
  options?: { env?: NodeJS.ProcessEnv; nodePath?: string },
): Promise<unknown> {
  const command = buildReadonlySurfaceCliCommand(request, options);

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
        reject(new Error(stderr.trim() || stdout.trim() || `Readonly host bridge command failed: ${code}`));
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
  ipcMain.handle(getReadonlySurfaceChannel(), async (_event, request: ReadonlySurfaceRunCommandRequest) => {
    return await runReadonlySurfaceCommand(request);
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
