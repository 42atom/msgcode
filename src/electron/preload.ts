import {
  createReadonlySurfaceBridge as createBridgeCore,
  getReadonlySurfaceChannel,
  getSendThreadInputChannel,
  getThreadUpdateChannel,
  type IpcInvokeLike,
  type IpcSubscribeLike,
} from "./readonly-surface-bridge.js";

type ReadonlySurfaceIpcChannel =
  | ReturnType<typeof getReadonlySurfaceChannel>
  | ReturnType<typeof getSendThreadInputChannel>;

type ReadonlySurfaceSubscribeChannel =
  ReturnType<typeof getThreadUpdateChannel>;

export interface IpcRendererLike extends IpcInvokeLike, IpcSubscribeLike {}

export function createReadonlySurfaceIpcWhitelist(
  ipcRenderer: IpcRendererLike,
): IpcInvokeLike & IpcSubscribeLike {
  const allowedInvoke = new Set<ReadonlySurfaceIpcChannel>([
    getReadonlySurfaceChannel(),
    getSendThreadInputChannel(),
  ]);
  const allowedSubscribe = new Set<ReadonlySurfaceSubscribeChannel>([
    getThreadUpdateChannel(),
  ]);

  return {
    async invoke(channel: string, request: unknown): Promise<unknown> {
      if (!allowedInvoke.has(channel as ReadonlySurfaceIpcChannel)) {
        throw new Error(`Readonly preload bridge rejected invoke channel: ${channel}`);
      }
      return await ipcRenderer.invoke(channel, request);
    },
    on(channel: string, listener: (_event: unknown, payload: unknown) => void): void {
      if (!allowedSubscribe.has(channel as ReadonlySurfaceSubscribeChannel)) {
        throw new Error(`Readonly preload bridge rejected subscribe channel: ${channel}`);
      }
      ipcRenderer.on(channel, listener);
    },
    off(channel: string, listener: (_event: unknown, payload: unknown) => void): void {
      if (!allowedSubscribe.has(channel as ReadonlySurfaceSubscribeChannel)) {
        throw new Error(`Readonly preload bridge rejected unsubscribe channel: ${channel}`);
      }
      ipcRenderer.off(channel, listener);
    },
  };
}

export async function installReadonlySurfaceBridge(): Promise<void> {
  const { contextBridge, ipcRenderer } = await import("electron");
  contextBridge.exposeInMainWorld(
    "msgcodeReadonlySurface",
    createBridgeCore(createReadonlySurfaceIpcWhitelist(ipcRenderer)),
  );
}

if (typeof process.versions.electron === "string") {
  void installReadonlySurfaceBridge();
}
