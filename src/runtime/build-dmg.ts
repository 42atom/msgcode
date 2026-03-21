import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface BuildDmgOptions {
  appPath: string;
  outputPath: string;
  volumeName?: string;
  clean?: boolean;
  hdiutilPath?: string;
  commandRunner?: (file: string, args: string[]) => Promise<void>;
}

export interface BuildDmgResult {
  appPath: string;
  outputPath: string;
  volumeName: string;
  signingStatus: "not-implemented";
  notarizationStatus: "not-implemented";
}

function resolveRequiredApp(appPath: string): string {
  const resolved = path.resolve(appPath);
  if (!existsSync(resolved)) {
    throw new Error(`Missing app bundle: ${resolved}`);
  }
  if (!existsSync(path.join(resolved, "Contents", "Info.plist"))) {
    throw new Error(`Invalid app bundle, missing Contents/Info.plist: ${resolved}`);
  }
  return resolved;
}

function defaultVolumeName(appPath: string): string {
  return path.basename(appPath, path.extname(appPath));
}

async function runDefaultCommand(file: string, args: string[]): Promise<void> {
  await execFileAsync(file, args);
}

export async function buildDmg(options: BuildDmgOptions): Promise<BuildDmgResult> {
  if (process.platform !== "darwin") {
    throw new Error("DMG packaging is only supported on macOS");
  }

  const appPath = resolveRequiredApp(options.appPath);
  const outputPath = path.resolve(options.outputPath);
  const volumeName = options.volumeName?.trim() || defaultVolumeName(appPath);
  const hdiutilPath = options.hdiutilPath || "hdiutil";
  const commandRunner = options.commandRunner || runDefaultCommand;
  const stagingRoot = await mkdtemp(path.join(os.tmpdir(), "msgcode-dmg-stage-"));

  try {
    if (options.clean !== false) {
      await rm(outputPath, { force: true });
    }

    await mkdir(path.dirname(outputPath), { recursive: true });
    await mkdir(stagingRoot, { recursive: true });
    await cp(appPath, path.join(stagingRoot, path.basename(appPath)), { recursive: true });

    await commandRunner(hdiutilPath, [
      "create",
      "-volname",
      volumeName,
      "-srcfolder",
      stagingRoot,
      "-format",
      "UDZO",
      "-ov",
      outputPath,
    ]);
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }

  return {
    appPath,
    outputPath,
    volumeName,
    signingStatus: "not-implemented",
    notarizationStatus: "not-implemented",
  };
}
