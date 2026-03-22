export interface ReadonlySurfaceRunCommandRequest {
  command: string;
  args?: string[];
}

export interface ReadonlySurfaceBridge {
  mode: "placeholder";
  runCommand(request: ReadonlySurfaceRunCommandRequest): Promise<never>;
}

export function createReadonlySurfaceBridge(): ReadonlySurfaceBridge {
  return {
    mode: "placeholder",
    async runCommand(request: ReadonlySurfaceRunCommandRequest): Promise<never> {
      const command = request.command.trim() || "<empty>";
      throw new Error(`Readonly host bridge not implemented yet: ${command}`);
    },
  };
}

export async function installReadonlySurfaceBridge(): Promise<void> {
  const { contextBridge } = await import("electron");
  contextBridge.exposeInMainWorld("msgcodeReadonlySurface", createReadonlySurfaceBridge());
}

if (typeof process.versions.electron === "string") {
  void installReadonlySurfaceBridge();
}
