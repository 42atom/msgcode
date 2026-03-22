export type ReadonlySurfaceCommand = "workspace-tree" | "thread";

export interface ReadonlySurfaceWorkspaceTreeRequest {
  command: "workspace-tree";
}

export interface ReadonlySurfaceThreadRequest {
  command: "thread";
  workspace: string;
  threadId: string;
}

export type ReadonlySurfaceRunCommandRequest =
  | ReadonlySurfaceWorkspaceTreeRequest
  | ReadonlySurfaceThreadRequest;

export interface ReadonlySurfaceBridge {
  mode: "live";
  runCommand(request: ReadonlySurfaceRunCommandRequest): Promise<unknown>;
}

export interface IpcInvokeLike {
  invoke(channel: string, request: ReadonlySurfaceRunCommandRequest): Promise<unknown>;
}

export function buildReadonlySurfaceCliArgs(request: ReadonlySurfaceRunCommandRequest): string[] {
  if (request.command === "workspace-tree") {
    return ["appliance", "workspace-tree", "--json"];
  }

  const workspace = request.workspace.trim();
  const threadId = request.threadId.trim();
  if (!workspace) {
    throw new Error("Readonly host bridge requires workspace for thread command");
  }
  if (!threadId) {
    throw new Error("Readonly host bridge requires threadId for thread command");
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

export function getReadonlySurfaceChannel(): "msgcode:readonly-run-command" {
  return "msgcode:readonly-run-command";
}

export function createReadonlySurfaceBridge(
  ipcInvoker: IpcInvokeLike,
  channel = getReadonlySurfaceChannel(),
): ReadonlySurfaceBridge {
  return {
    mode: "live",
    async runCommand(request: ReadonlySurfaceRunCommandRequest): Promise<unknown> {
      return await ipcInvoker.invoke(channel, request);
    },
  };
}
