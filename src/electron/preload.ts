import {
  createReadonlySurfaceBridge as createBridgeCore,
  getReadonlySurfaceChannel,
} from "./readonly-surface-bridge.js";

export async function installReadonlySurfaceBridge(): Promise<void> {
  const { contextBridge, ipcRenderer } = await import("electron");
  contextBridge.exposeInMainWorld(
    "msgcodeReadonlySurface",
    createBridgeCore(ipcRenderer, getReadonlySurfaceChannel()),
  );
}

if (typeof process.versions.electron === "string") {
  void installReadonlySurfaceBridge();
}
