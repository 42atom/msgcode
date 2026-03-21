import path from "node:path";
import type { Diagnostic } from "../memory/types.js";
import { getVersionInfo } from "../version.js";
import {
  isLaunchdSupported,
  readLaunchAgentRuntime,
  resolveLaunchAgentLogPaths,
  resolveMsgcodeLogDir,
} from "./launchd.js";

export interface WorkspaceGeneralSurfaceData {
  workspacePath: string;
  workspaceRoot: string;
  log: {
    dir: string;
    filePath: string;
    stdoutPath: string;
    stderrPath: string;
  };
  startup: {
    mode: "launchd" | "manual";
    supported: boolean;
    label: string;
    installed: boolean;
    status: "running" | "stopped" | "missing" | "unknown";
    plistPath: string;
  };
}

export async function readWorkspaceGeneralSurface(
  workspacePath: string,
): Promise<{ data: WorkspaceGeneralSurfaceData; warnings: Diagnostic[] }> {
  const warnings: Diagnostic[] = [];
  const versionInfo = getVersionInfo();
  const launchRuntime = await readLaunchAgentRuntime(process.env);
  const launchLogs = resolveLaunchAgentLogPaths(process.env);
  const logDir = resolveMsgcodeLogDir(process.env);
  const workspaceRoot = String(versionInfo.workspaceRoot ?? "").trim();

  if (!workspaceRoot) {
    warnings.push({
      code: "WORKSPACE_GENERAL_ROOT_MISSING",
      message: "当前没有声明 WORKSPACE_ROOT",
      hint: "设置 WORKSPACE_ROOT 后，通用页才能稳定显示场景工作区根目录",
      details: {
        workspacePath,
      },
    });
  }

  return {
    data: {
      workspacePath,
      workspaceRoot,
      log: {
        dir: logDir,
        filePath: path.join(logDir, "msgcode.log"),
        stdoutPath: launchLogs.stdoutPath,
        stderrPath: launchLogs.stderrPath,
      },
      startup: {
        mode: isLaunchdSupported() ? "launchd" : "manual",
        supported: isLaunchdSupported(),
        label: launchRuntime.label,
        installed: launchRuntime.installed,
        status: launchRuntime.status,
        plistPath: launchRuntime.plistPath,
      },
    },
    warnings,
  };
}
