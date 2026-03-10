/**
 * msgcode: daemon / launchd 探针
 *
 * 原则：
 * - 只读状态，不负责保活
 * - 用于把 daemon 常驻状态收进 `msgcode status`
 */

import type { ProbeResult } from "../types.js";
import { readLaunchAgentRuntime, readLastDaemonErrorLine } from "../../runtime/launchd.js";
import { readSingletonPid } from "../../runtime/singleton.js";

export async function probeDaemon(): Promise<ProbeResult> {
  const runtime = await readLaunchAgentRuntime(process.env);
  const singletonPid = await readSingletonPid("msgcode");
  const lastError = await readLastDaemonErrorLine(process.env);

  const details: Record<string, unknown> = {
    label: runtime.label,
    plist_path: runtime.plistPath,
    launchd_stdout: runtime.stdoutPath,
    launchd_stderr: runtime.stderrPath,
    installed: runtime.installed,
    loaded: runtime.loaded,
    launchd_status: runtime.status,
    pid: runtime.pid ?? null,
    singleton_pid: singletonPid ?? null,
    last_exit_status: runtime.lastExitStatus ?? null,
    last_exit_reason: runtime.lastExitReason ?? null,
  };

  if (lastError && runtime.status !== "running") {
    details.last_error_line = lastError;
  }

  if (runtime.detail) {
    details.detail = runtime.detail;
  }

  if (process.platform !== "darwin") {
    return {
      name: "daemon",
      status: "skip",
      message: "当前平台未启用 launchd 守护",
      details,
    };
  }

  if (runtime.status === "running") {
    return {
      name: "daemon",
      status: "pass",
      message: `daemon 已由 launchd 托管运行${runtime.pid ? ` (pid=${runtime.pid})` : ""}`,
      details,
    };
  }

  if (!runtime.installed && singletonPid) {
    return {
      name: "daemon",
      status: "warning",
      message: `daemon 正在运行 (pid=${singletonPid})，但未由 launchd 托管`,
      details,
      fixHint: "运行 `msgcode start`，让 daemon 迁移到 launchd 托管。",
    };
  }

  if (!runtime.installed) {
    return {
      name: "daemon",
      status: "warning",
      message: "launchd 守护尚未安装",
      details,
      fixHint: "运行 `msgcode start` 安装并启动 launchd 守护。",
    };
  }

  return {
    name: "daemon",
    status: "warning",
    message: "launchd 守护已安装但当前未运行",
    details,
    fixHint: "运行 `msgcode start` 或 `msgcode restart` 重新拉起守护进程。",
  };
}
