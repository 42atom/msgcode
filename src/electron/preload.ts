import {
  createThreadSurfaceBridge as createBridgeCore,
  getThreadSurfaceReadChannel,
  getSendThreadInputChannel,
  getThreadUpdateChannel,
  type IpcInvokeLike,
  type IpcSubscribeLike,
} from "./readonly-surface-bridge.js";

type ThreadSurfaceIpcChannel =
  | ReturnType<typeof getThreadSurfaceReadChannel>
  | ReturnType<typeof getSendThreadInputChannel>;

type ThreadSurfaceSubscribeChannel =
  ReturnType<typeof getThreadUpdateChannel>;

export interface IpcRendererLike extends IpcInvokeLike, IpcSubscribeLike {}

export function createThreadSurfaceIpcWhitelist(
  ipcRenderer: IpcRendererLike,
): IpcInvokeLike & IpcSubscribeLike {
  const allowedInvoke = new Set<ThreadSurfaceIpcChannel>([
    getThreadSurfaceReadChannel(),
    getSendThreadInputChannel(),
  ]);
  const allowedSubscribe = new Set<ThreadSurfaceSubscribeChannel>([
    getThreadUpdateChannel(),
  ]);

  return {
    async invoke(channel: string, request: unknown): Promise<unknown> {
      if (!allowedInvoke.has(channel as ThreadSurfaceIpcChannel)) {
        throw new Error(`Thread surface preload rejected invoke channel: ${channel}`);
      }
      return await ipcRenderer.invoke(channel, request);
    },
    on(channel: string, listener: (_event: unknown, payload: unknown) => void): void {
      if (!allowedSubscribe.has(channel as ThreadSurfaceSubscribeChannel)) {
        throw new Error(`Thread surface preload rejected subscribe channel: ${channel}`);
      }
      ipcRenderer.on(channel, listener);
    },
    off(channel: string, listener: (_event: unknown, payload: unknown) => void): void {
      if (!allowedSubscribe.has(channel as ThreadSurfaceSubscribeChannel)) {
        throw new Error(`Thread surface preload rejected unsubscribe channel: ${channel}`);
      }
      ipcRenderer.off(channel, listener);
    },
  };
}

export async function installThreadSurfaceBridge(): Promise<void> {
  const { contextBridge, ipcRenderer } = await import("electron");
  contextBridge.exposeInMainWorld(
    "msgcodeThreadSurface",
    createBridgeCore(createThreadSurfaceIpcWhitelist(ipcRenderer)),
  );
}

if (typeof process.versions.electron === "string") {
  void installThreadSurfaceBridge();
}
