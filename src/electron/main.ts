import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
  const { app, BrowserWindow } = await import("electron");

  const openWindow = async (): Promise<void> => {
    const allWindows = BrowserWindow.getAllWindows();
    if (allWindows.length > 0) {
      allWindows[0]?.focus();
      return;
    }
    await createMainWindow(entryModuleUrl);
  };

  await app.whenReady();
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
