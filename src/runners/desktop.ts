/**
 * msgcode: Desktop Runner
 *
 * 职责：
 * - 维护 msgcode-desktopctl session 池
 * - 发现 desktopctl 可执行文件
 * - 通过 RPC 调用 Desktop Bridge
 * - 解析桌面证据 artifacts
 */

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
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

interface SessionRequest {
  id: string;
  workspacePath: string;
  method: string;
  params: Record<string, unknown>;
  timeoutMs?: number;
}

interface SessionResponse {
  id: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface SessionState {
  proc: ChildProcess;
  lastUsedAt: number;
  isProcessing: boolean;
  pendingRequests: Array<{
    request: SessionRequest;
    resolve: (response: SessionResponse) => void;
    reject: (error: Error) => void;
    timeoutMs: number;
  }>;
  stdoutBuffer: string;
  responseResolvers: Map<string, (response: SessionResponse) => void>;
  idleTimer?: NodeJS.Timeout;
}

class DesktopSessionPool {
  private readonly desktopctlPath: string;
  private readonly sessions = new Map<string, SessionState>();
  private readonly idleTimeoutMs = 60000;

  constructor(desktopctlPath: string) {
    this.desktopctlPath = desktopctlPath;
    this.startIdleCleanup();
  }

  async send(request: SessionRequest): Promise<SessionResponse> {
    const workspacePath = request.workspacePath;
    let session = this.sessions.get(workspacePath);

    if (!session || !this.isSessionAlive(session)) {
      logger.debug(`[DesktopSessionPool] 创建新 session: ${workspacePath}`);
      session = await this.createSession(workspacePath);
      this.sessions.set(workspacePath, session);
    }

    this.resetIdleTimer(session);

    let waited = 0;
    const maxWait = 5000;
    while (session.isProcessing && waited < maxWait) {
      await this.sleep(50);
      waited += 50;
    }

    if (session.isProcessing) {
      throw new Error("Session busy: previous request still processing");
    }

    return this.sendRequest(session, request);
  }

  private async createSession(workspacePath: string): Promise<SessionState> {
    const proc = spawn(this.desktopctlPath, ["session", workspacePath, "--idle-ms", String(this.idleTimeoutMs)], {
      cwd: workspacePath,
      env: { ...process.env, PWD: workspacePath },
    });

    const session: SessionState = {
      proc,
      lastUsedAt: Date.now(),
      isProcessing: false,
      pendingRequests: [],
      stdoutBuffer: "",
      responseResolvers: new Map(),
    };

    proc.stdout?.on("data", (data: Buffer) => {
      session.stdoutBuffer += data.toString();
      this.processStdoutLines(session);
    });

    proc.stderr?.on("data", (data: Buffer) => {
      logger.debug(`[DesktopSession stderr] ${data.toString().trim()}`);
    });

    proc.on("close", (code, signal) => {
      logger.debug(`[DesktopSession] 进程退出: code=${code}, signal=${signal}`);
      this.sessions.delete(workspacePath);
      for (const { reject } of session.pendingRequests) {
        reject(new Error(`Session closed: code=${code}, signal=${signal}`));
      }
      session.pendingRequests = [];
    });

    proc.on("error", (err) => {
      logger.error(`[DesktopSession] 进程错误: ${err.message}`);
      this.sessions.delete(workspacePath);
      for (const { reject } of session.pendingRequests) {
        reject(err);
      }
      session.pendingRequests = [];
    });

    await this.sleep(500);
    logger.debug(`[DesktopSession] Session 进程已启动: pid=${proc.pid}`);
    return session;
  }

  private async sendRequest(session: SessionState, request: SessionRequest): Promise<SessionResponse> {
    if (session.isProcessing) {
      throw new Error(`Session busy: ${session.proc.pid} is processing`);
    }

    session.isProcessing = true;
    const timeoutMs = request.timeoutMs ?? 30000;

    const promise = new Promise<SessionResponse>((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        session.responseResolvers.delete(request.id);
        rejectRequest(new Error(`Request timeout: ${request.id}`));
      }, timeoutMs);

      session.responseResolvers.set(request.id, (response) => {
        clearTimeout(timer);
        if (response.exitCode === 0) {
          resolveRequest(response);
          return;
        }
        rejectRequest(new Error(`Request failed: ${response.stderr || response.stdout}`));
      });

      const written = session.proc.stdin?.write(`${JSON.stringify(request)}\n`);
      if (!written) {
        clearTimeout(timer);
        session.responseResolvers.delete(request.id);
        rejectRequest(new Error("Failed to write to session stdin"));
      }
    });

    try {
      return await promise;
    } finally {
      session.isProcessing = false;
    }
  }

  private processStdoutLines(session: SessionState): void {
    const lines = session.stdoutBuffer.split("\n");
    session.stdoutBuffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const response: SessionResponse = JSON.parse(line);
        const resolver = session.responseResolvers.get(response.id);
        if (resolver) {
          resolver(response);
          session.responseResolvers.delete(response.id);
        } else {
          logger.warn(`[DesktopSession] 未找到响应 resolver: ${response.id}`);
        }
      } catch {
        logger.error(`[DesktopSession] 解析响应失败: ${line}`);
      }
    }
  }

  private isSessionAlive(session: SessionState): boolean {
    return session.proc.exitCode === null && !session.proc.killed;
  }

  private resetIdleTimer(session: SessionState): void {
    session.lastUsedAt = Date.now();
    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
    }
    session.idleTimer = setTimeout(() => {
      logger.debug("[DesktopSession] Idle 超时，清理 session");
      this.killSession(session);
    }, this.idleTimeoutMs);
  }

  private killSession(session: SessionState): void {
    try {
      session.proc.kill("SIGTERM");
    } catch {
    }
  }

  private startIdleCleanup(): void {
    setInterval(() => {
      const now = Date.now();
      for (const [workspacePath, session] of this.sessions.entries()) {
        if (now - session.lastUsedAt > this.idleTimeoutMs) {
          logger.debug(`[DesktopSessionPool] 清理 idle session: ${workspacePath}`);
          this.killSession(session);
          this.sessions.delete(workspacePath);
        }
      }
    }, 30000);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
  }
}

let globalDesktopSessionPool: DesktopSessionPool | null = null;

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

  logger.error(`[DesktopSessionPool] 当前工作目录: ${process.cwd()}`);
  throw new Error("msgcode-desktopctl not found");
}

async function getDesktopSessionPool(): Promise<DesktopSessionPool> {
  if (globalDesktopSessionPool) {
    return globalDesktopSessionPool;
  }

  const desktopctlPath = findDesktopctlPath();
  logger.debug(`[DesktopSessionPool] desktopctl 路径: ${desktopctlPath}`);
  globalDesktopSessionPool = new DesktopSessionPool(desktopctlPath);
  return globalDesktopSessionPool;
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

export async function runDesktopTool(options: DesktopRunnerOptions): Promise<DesktopRunnerResult> {
  const { workspacePath, method, params = {}, timeoutMs = 120000 } = options;
  const pool = await getDesktopSessionPool();
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

  const response = await pool.send({
    id: requestId,
    workspacePath,
    method,
    params: finalParams,
    timeoutMs,
  });

  return {
    exitCode: response.exitCode,
    stdout: response.stdout,
    stderr: response.stderr,
    artifacts: parseDesktopArtifacts(response.stdout),
  };
}
