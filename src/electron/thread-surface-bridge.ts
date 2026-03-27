export type ThreadSurfaceCommand =
  | "workspace-tree"
  | "thread"
  | "profile"
  | "capabilities"
  | "hall"
  | "neighbor";

export interface SendThreadInputRequest {
  workspacePath: string;
  threadId: string;
  text: string;
}

export interface ThreadUpdateEvent {
  workspacePath: string;
  threadId: string;
}

export interface ThreadSurfaceWorkspaceTreeRequest {
  command: "workspace-tree";
}

export interface ThreadSurfaceThreadRequest {
  command: "thread";
  workspace: string;
  threadId: string;
}

export interface ThreadSurfaceWorkspaceRequest {
  command: "profile" | "capabilities" | "hall" | "neighbor";
  workspace: string;
}

export type ThreadSurfaceRunCommandRequest =
  | ThreadSurfaceWorkspaceTreeRequest
  | ThreadSurfaceThreadRequest
  | ThreadSurfaceWorkspaceRequest;

export interface ThreadSurfaceBridge {
  mode: "live";
  runCommand(request: ThreadSurfaceRunCommandRequest): Promise<unknown>;
  sendThreadInput(request: SendThreadInputRequest): Promise<void>;
  onThreadUpdate(listener: (event: ThreadUpdateEvent) => void): () => void;
}

export interface IpcInvokeLike {
  invoke(channel: string, request: unknown): Promise<unknown>;
}

export interface IpcSubscribeLike {
  on(
    channel: string,
    listener: (_event: unknown, payload: unknown) => void,
  ): void;
  off(
    channel: string,
    listener: (_event: unknown, payload: unknown) => void,
  ): void;
}

export function buildThreadSurfaceCliArgs(request: ThreadSurfaceRunCommandRequest): string[] {
  if (request.command === "workspace-tree") {
    return ["appliance", "workspace-tree", "--json"];
  }

  const workspace = request.workspace.trim();
  if (!workspace) {
    throw new Error(`Thread surface bridge requires workspace for ${request.command} command`);
  }

  if (
    request.command === "profile" ||
    request.command === "capabilities" ||
    request.command === "hall" ||
    request.command === "neighbor"
  ) {
    return [
      "appliance",
      request.command,
      "--workspace",
      workspace,
      "--json",
    ];
  }

  const threadRequest = request as ThreadSurfaceThreadRequest;
  const threadId = threadRequest.threadId.trim();
  if (!threadId) {
    throw new Error("Thread surface bridge requires threadId for thread command");
  }

  return [
    "appliance",
    "thread",
    "--workspace",
    workspace,
    "--thread-id",
    threadId,
    "--json",
  ];
}

export function getThreadSurfaceReadChannel(): "msgcode:thread-surface-run-command" {
  return "msgcode:thread-surface-run-command";
}

export function getSendThreadInputChannel(): "msgcode:thread-send-input" {
  return "msgcode:thread-send-input";
}

export function getThreadUpdateChannel(): "msgcode:thread-updated" {
  return "msgcode:thread-updated";
}

export function createThreadSurfaceBridge(
  ipcInvoker: IpcInvokeLike & Partial<IpcSubscribeLike>,
  readChannel = getThreadSurfaceReadChannel(),
  writeChannel = getSendThreadInputChannel(),
  updateChannel = getThreadUpdateChannel(),
): ThreadSurfaceBridge {
  return {
    mode: "live",
    async runCommand(request: ThreadSurfaceRunCommandRequest): Promise<unknown> {
      return await ipcInvoker.invoke(readChannel, request);
    },
    async sendThreadInput(request: SendThreadInputRequest): Promise<void> {
      await ipcInvoker.invoke(writeChannel, request);
    },
    onThreadUpdate(listener: (event: ThreadUpdateEvent) => void): () => void {
      if (!ipcInvoker.on || !ipcInvoker.off) {
        return () => {};
      }
      const handleUpdate = (_event: unknown, payload: unknown): void => {
        if (!payload || typeof payload !== "object") {
          return;
        }
        const next = payload as Partial<ThreadUpdateEvent>;
        listener({
          workspacePath: String(next.workspacePath ?? ""),
          threadId: String(next.threadId ?? ""),
        });
      };
      ipcInvoker.on(updateChannel, handleUpdate);
      return () => {
        ipcInvoker.off?.(updateChannel, handleUpdate);
      };
    },
  };
}
