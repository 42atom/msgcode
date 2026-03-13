/**
 * msgcode: Desktop Runner
 *
 * 职责：
 * - 发现 msgcode-desktopctl 可执行文件
 * - 通过单次 rpc 调用 legacy desktop bridge
 * - 解析桌面证据 artifacts
 */

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { logger } from "../logger/index.js";

export interface DesktopRunnerOptions {
  workspacePath: string;
  method: string;
  params?: Record<string, unknown>;
  timeoutMs?: number;
}

export interface DesktopRunnerResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  artifacts?: Array<{ kind: "desktop" | "log"; path: string }>;
}

function findDesktopctlPath(): string {
  const envOverride = process.env.MSGCODE_DESKTOPCTL_PATH;
  if (envOverride && existsSync(envOverride)) {
    return envOverride;
  }

  let currentDir = process.cwd();
  while (currentDir !== "/") {
    const releasePath = resolve(currentDir, "mac", "msgcode-desktopctl", ".build", "release", "msgcode-desktopctl");
    if (existsSync(releasePath)) {
      return releasePath;
    }

    const debugPath = resolve(currentDir, "mac", "msgcode-desktopctl", ".build", "debug", "msgcode-desktopctl");
    if (existsSync(debugPath)) {
      return debugPath;
    }

    currentDir = resolve(currentDir, "..");
  }

  logger.error(`[DesktopRunner] 当前工作目录: ${process.cwd()}`);
  throw new Error("msgcode-desktopctl not found");
}

function parseDesktopArtifacts(stdout: string): Array<{ kind: "desktop" | "log"; path: string }> | undefined {
  try {
    const jsonOut = JSON.parse(stdout);
    const artifacts: Array<{ kind: "desktop" | "log"; path: string }> = [];

    if (jsonOut.result?.evidence?.dir) {
      artifacts.push({
        kind: "desktop",
        path: jsonOut.result.evidence.dir as string,
      });
    }

    if (jsonOut.result?.evidence?.dir && jsonOut.result?.evidence?.envPath) {
      artifacts.push({
        kind: "log",
        path: `${jsonOut.result.evidence.dir}/${jsonOut.result.evidence.envPath}`,
      });
    }

    return artifacts.length > 0 ? artifacts : undefined;
  } catch {
    return undefined;
  }
}

async function runDesktopctlRpc(args: {
  desktopctlPath: string;
  workspacePath: string;
  method: string;
  paramsJson: string;
  timeoutMs: number;
}): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const { desktopctlPath, workspacePath, method, paramsJson, timeoutMs } = args;

  return await new Promise((resolveRun, rejectRun) => {
    const child = spawn(
      desktopctlPath,
      ["rpc", workspacePath, "--method", method, "--params-json", paramsJson],
      {
        cwd: workspacePath,
        env: { ...process.env, PWD: workspacePath },
      }
    );

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const killTimer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1000).unref();
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(killTimer);
      rejectRun(error);
    });

    child.on("close", (exitCode) => {
      clearTimeout(killTimer);
      if (timedOut) {
        rejectRun(new Error("TOOL_TIMEOUT"));
        return;
      }

      resolveRun({
        exitCode,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
  });
}

export async function runDesktopTool(options: DesktopRunnerOptions): Promise<DesktopRunnerResult> {
  const { workspacePath, method, params = {}, timeoutMs = 120000 } = options;
  const desktopctlPath = findDesktopctlPath();
  const requestId = randomUUID();
  const finalParams: Record<string, unknown> = { ...params };

  if (!finalParams.meta) {
    finalParams.meta = {
      schemaVersion: 1,
      requestId,
      workspacePath,
      timeoutMs,
    };
  }

  if (finalParams.meta && typeof finalParams.meta === "object" && !Array.isArray(finalParams.meta)) {
    finalParams.meta = {
      ...(finalParams.meta as Record<string, unknown>),
      requestId,
      workspacePath,
      timeoutMs,
    };
  }

  logger.debug(`[DesktopRunner] rpc ${method}`);
  const response = await runDesktopctlRpc({
    desktopctlPath,
    workspacePath,
    method,
    paramsJson: JSON.stringify(finalParams),
    timeoutMs,
  });

  return {
    exitCode: response.exitCode,
    stdout: response.stdout,
    stderr: response.stderr,
    artifacts: parseDesktopArtifacts(response.stdout),
  };
}
