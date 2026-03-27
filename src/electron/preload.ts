import {
  createReadonlySurfaceBridge as createBridgeCore,
} from "./readonly-surface-bridge.js";

export async function installReadonlySurfaceBridge(): Promise<void> {
  const { contextBridge, ipcRenderer } = await import("electron");
  contextBridge.exposeInMainWorld(
    "msgcodeReadonlySurface",
    createBridgeCore(ipcRenderer),
  );
}

if (typeof process.versions.electron === "string") {
  void installReadonlySurfaceBridge();
}
