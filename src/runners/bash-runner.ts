/**
 * msgcode: Bash Runner (P5.7-R3f)
 *
 * 职责：
 * - 支持可中断执行（abort/timeout 必须 kill process tree）
 * - 支持执行过程流式输出（partial update）
 * - 支持大输出尾部截断 + 完整输出落盘（full output path 可追踪）
 */

import { spawn, type ChildProcess } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

// ============================================
// 类型定义
// ============================================

/**
 * Bash 执行选项
 */
export interface BashRunnerOptions {
  /** 命令内容 */
  command: string;
  /** 工作目录 */
  cwd: string;
  /** 进程环境变量（可选；默认继承当前进程） */
  env?: NodeJS.ProcessEnv;
  /** 超时时间（毫秒），默认 120000 */
  timeoutMs?: number;
  /** 取消信号（可选） */
  signal?: AbortSignal;
  /** 流式更新回调（可选） */
  onUpdate?: (data: { stdout?: string; stderr?: string }) => void;
}

/**
 * Bash 执行结果
 */
export interface BashRunnerResult {
  /** 成功与否 */
  ok: boolean;
  /** 退出码 */
  exitCode: number;
  /** stdout 尾部（截断后） */
  stdoutTail: string;
  /** stderr 尾部（截断后） */
  stderrTail: string;
  /** 完整输出文件路径（如果超阈值） */
  fullOutputPath?: string;
  /** 错误信息（失败时） */
  error?: string;
  /** 执行耗时（毫秒） */
  durationMs: number;
}

// ============================================
// 常量配置
// ============================================

/** 默认超时时间：2 分钟 */
const DEFAULT_TIMEOUT_MS = 120000;

/** 输出行数截断阈值 */
const MAX_OUTPUT_LINES = 1000;

/** 输出字节截断阈值 */
const MAX_OUTPUT_BYTES = 100 * 1024; // 100KB

/** 日志文件名前缀 */
const LOG_PREFIX = "bash-output";

/** 托管 Bash 候选路径 */
export const MANAGED_BASH_CANDIDATES = [
  "/opt/homebrew/bin/bash",
  "/usr/local/bin/bash",
] as const;

interface BashRunnerDeps {
  resolveManagedBashPath: () => string | null;
}

function defaultResolveManagedBashPath(): string | null {
  for (const candidate of MANAGED_BASH_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const bashRunnerDeps: BashRunnerDeps = {
  resolveManagedBashPath: defaultResolveManagedBashPath,
};

const defaultBashRunnerDeps: BashRunnerDeps = {
  ...bashRunnerDeps,
};

export function __setBashRunnerTestDeps(overrides: Partial<BashRunnerDeps>): void {
  if (overrides.resolveManagedBashPath) {
    bashRunnerDeps.resolveManagedBashPath = overrides.resolveManagedBashPath;
  }
}

export function __resetBashRunnerTestDeps(): void {
  bashRunnerDeps.resolveManagedBashPath = defaultBashRunnerDeps.resolveManagedBashPath;
}

function formatManagedBashMissingError(): string {
  return [
    "托管 Bash 缺失：bash 工具只认",
    MANAGED_BASH_CANDIDATES.join(" 或 "),
    "；请先安装 Homebrew bash（brew install bash）。",
  ].join(" ");
}

// ============================================
// 进程树清理工具
// ============================================

/**
 * 递归获取子进程的所有子进程 PID
 */
async function getChildPids(pid: number): Promise<number[]> {
  const { exec } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execAsync = promisify(exec);

  try {
    // macOS: 使用 pgrep -P 获取子进程
    const { stdout } = await execAsync(`pgrep -P ${pid} 2>/dev/null || true`);
    const childPids = stdout
      .trim()
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => parseInt(line.trim(), 10))
      .filter((n) => !Number.isNaN(n));

    const allPids = [...childPids];
    for (const childPid of childPids) {
      const grandchildren = await getChildPids(childPid);
      allPids.push(...grandchildren);
    }
    return allPids;
  } catch {
    // pgrep 失败时返回空数组
    return [];
  }
}

/**
 * 杀死进程树（主进程 + 所有子进程）
 * P5.7-R3f: timeout kill process tree
 */
export async function killProcessTree(
  proc: ChildProcess,
  signal: NodeJS.Signals = "SIGTERM"
): Promise<void> {
  const pid = proc.pid;
  if (!pid) return;

  try {
    // 先获取所有子进程 PID
    const allChildPids = await getChildPids(pid);

    // 先杀子进程（从最深的子进程开始）
    for (const childPid of allChildPids.reverse()) {
      try {
        process.kill(childPid, signal);
      } catch {
        // 进程已退出，忽略
      }
    }

    // 再杀主进程
    try {
      proc.kill(signal);
    } catch {
      // 进程已退出，忽略
    }

    // 等待进程完全退出
    await new Promise<void>((resolve) => {
      const checkExit = setInterval(() => {
        if (proc.exitCode !== null || proc.signalCode !== null) {
          clearInterval(checkExit);
          resolve();
        }
      }, 50);

      // 最多等待 5 秒
      setTimeout(() => {
        clearInterval(checkExit);
        resolve();
      }, 5000);
    });
  } catch {
    // 忽略清理错误
  }
}

// ============================================
// 输出截断工具
// ============================================

/**
 * 截断输出（按行数 + 字节双阈值）
 * 返回截断后的内容和是否超阈值
 */
function truncateOutput(
  output: string
): { truncated: string; exceeded: boolean; totalBytes: number } {
  const totalBytes = Buffer.byteLength(output, "utf-8");

  // 检查是否超阈值
  const exceeded =
    output.split("\n").length > MAX_OUTPUT_LINES ||
    totalBytes > MAX_OUTPUT_BYTES;

  if (!exceeded) {
    return { truncated: output, exceeded: false, totalBytes };
  }

  // 超阈值：返回尾部窗口
  const lines = output.split("\n");
  const tailLines = lines.slice(-MAX_OUTPUT_LINES);
  let truncated = tailLines.join("\n");

  // 如果字节数仍然超阈值，继续截断
  if (Buffer.byteLength(truncated, "utf-8") > MAX_OUTPUT_BYTES) {
    truncated = truncated.slice(-MAX_OUTPUT_BYTES);
  }

  return { truncated, exceeded: true, totalBytes };
}

/**
 * 写入完整输出到临时文件
 * P5.7-R3f: truncation + fullOutputPath
 */
async function writeFullOutput(
  workspacePath: string,
  stdout: string,
  stderr: string,
  exitCode: number,
  command: string
): Promise<string> {
  const logsDir = join(workspacePath, "artifacts", "logs");
  await mkdir(logsDir, { recursive: true });

  const filename = `${LOG_PREFIX}-${randomUUID()}.log`;
  const fullPath = join(logsDir, filename);

  const content = [
    `# Bash Execution Log`,
    `# Command: ${command}`,
    `# Exit Code: ${exitCode}`,
    `# Timestamp: ${new Date().toISOString()}`,
    ``,
    `## STDOUT`,
    stdout,
    ``,
    `## STDERR`,
    stderr,
  ].join("\n");

  await writeFile(fullPath, content, "utf-8");
  return fullPath;
}

// ============================================
// Bash 执行主函数
// ============================================

/**
 * 执行 Bash 命令
 *
 * @param options 执行选项
 * @returns 执行结果
 */
export async function runBashCommand(
  options: BashRunnerOptions
): Promise<BashRunnerResult> {
  const { command, cwd, env, timeoutMs = DEFAULT_TIMEOUT_MS, signal, onUpdate } = options;
  const bashPath = bashRunnerDeps.resolveManagedBashPath();

  const started = Date.now();
  let stdout = "";
  let stderr = "";
  let exitCode = -1;
  let proc: ChildProcess | null = null;
  let timeoutTimer: NodeJS.Timeout | null = null;
  let isAborted = false;

  if (!bashPath) {
    return {
      ok: false,
      exitCode: -1,
      stdoutTail: "",
      stderrTail: "",
      error: formatManagedBashMissingError(),
      durationMs: Date.now() - started,
    };
  }

  try {
    // 创建 Promise 执行 shell 命令
    const result = await new Promise<{ exitCode: number; stdout: string; stderr: string }>(
      (resolve, reject) => {
        // 显式执行托管 Bash，禁止 shell 自动漂移到 /bin/sh 或登录 shell。
        proc = spawn(bashPath, ["--noprofile", "--norc", "-lc", command], {
          cwd,
          shell: false,
          env: { ...process.env, ...env, PWD: cwd },
        });

        // 处理 stdout（流式输出）
        proc.stdout?.on("data", (data: Buffer) => {
          const chunk = data.toString();
          stdout += chunk;
          onUpdate?.({ stdout: chunk });
        });

        // 处理 stderr（流式输出）
        proc.stderr?.on("data", (data: Buffer) => {
          const chunk = data.toString();
          stderr += chunk;
          onUpdate?.({ stderr: chunk });
        });

        // 处理进程退出
        proc.on("close", (code) => {
          if (timeoutTimer) clearTimeout(timeoutTimer);
          exitCode = code ?? -1;
          resolve({ exitCode, stdout, stderr });
        });

        // 处理进程错误
        proc.on("error", (err) => {
          if (timeoutTimer) clearTimeout(timeoutTimer);
          reject(err);
        });

        // 设置超时定时器
        timeoutTimer = setTimeout(async () => {
          if (proc && proc.exitCode === null && proc.signalCode === null) {
            isAborted = true;
            await killProcessTree(proc, "SIGTERM");
            resolve({ exitCode: -1, stdout, stderr });
          }
        }, timeoutMs);

        // 监听 abort 信号
        if (signal) {
          const abortHandler = async () => {
            if (proc && proc.exitCode === null && proc.signalCode === null) {
              isAborted = true;
              await killProcessTree(proc, "SIGTERM");
              resolve({ exitCode: -1, stdout, stderr });
            }
          };
          signal.addEventListener("abort", abortHandler, { once: true });
        }
      }
    );

    exitCode = result.exitCode;

    // 截断输出
    const stdoutResult = truncateOutput(stdout);
    const stderrResult = truncateOutput(stderr);

    // 构建结果
    const runnerResult: BashRunnerResult = {
      ok: exitCode === 0 && !isAborted,
      exitCode,
      stdoutTail: stdoutResult.truncated,
      stderrTail: stderrResult.truncated,
      durationMs: Date.now() - started,
    };

    // 如果输出超阈值，写入完整日志
    if (stdoutResult.exceeded || stderrResult.exceeded) {
      runnerResult.fullOutputPath = await writeFullOutput(
        cwd,
        stdout,
        stderr,
        exitCode,
        command
      );
    }

    // 如果是超时/中断导致的，标记错误
    if (isAborted) {
      runnerResult.error = `命令执行超时 (${timeoutMs}ms)，进程已终止`;
    }

    return runnerResult;
  } catch (err) {
    // 清理资源
    if (timeoutTimer) clearTimeout(timeoutTimer);
    if (proc) await killProcessTree(proc, "SIGKILL");

    return {
      ok: false,
      exitCode: -1,
      stdoutTail: "",
      stderrTail: "",
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - started,
    };
  }
}
