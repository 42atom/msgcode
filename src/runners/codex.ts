/**
 * msgcode: Codex Runner（M5-3: Codex 执行臂）
 *
 * 使用 codex exec 非交互模式
 * 固定参数：--skip-git-repo-check --sandbox read-only --color never --output-last-message <tmp>
 * 超时/错误处理带 fixHint
 * 安全：使用 spawn + 参数数组，避免 shell 命令注入
 */

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { unlink } from "node:fs/promises";

/**
 * Codex 执行选项
 */
export interface CodexExecOptions {
  /** 工作目录路径 */
  workspacePath: string;
  /** 用户提示词 */
  prompt: string;
  /** 超时时间（毫秒），默认 60000 (60秒) */
  timeoutMs?: number;
  /** 沙箱模式，默认 read-only */
  sandbox?: "read-only" | "workspace-write";
}

/**
 * Codex 执行结果
 */
export interface CodexExecResult {
  /** 是否成功 */
  success: boolean;
  /** Codex 返回的答复 */
  response?: string;
  /** 错误信息 */
  error?: string;
  /** 错误码（用于分类） */
  errorCode?: "CODEX_NOT_INSTALLED" | "CODEX_MODE_BLOCKED" | "CODEX_EXEC_FAILED" | "CODEX_TIMEOUT" | "CODEX_NOT_LOGGED_IN";
}

/**
 * 运行 Codex exec 非交互模式（安全版本：使用 spawn + 参数数组）
 *
 * @param options Codex 执行选项
 * @returns 执行结果
 */
export async function runCodexExec(options: CodexExecOptions): Promise<CodexExecResult> {
  const {
    workspacePath,
    prompt,
    timeoutMs = 60000,
    sandbox = "read-only",
  } = options;

  // 1. 生成临时文件路径用于输出
  const outputFile = join(tmpdir(), `codex-output-${randomBytes(8).toString("hex")}.txt`);

  return new Promise((resolve) => {
    // 2. 构建 codex exec 参数数组（避免命令注入）
    const args = [
      "exec",
      "-C", workspacePath,
      "--skip-git-repo-check",
      "--sandbox", sandbox,
      "--color", "never",
      "--output-last-message", outputFile,
      prompt,
    ];

    // 3. 使用 spawn 启动 codex（shell: false 避免命令注入）
    const codex = spawn("codex", args, {
      shell: false,
      env: {
        ...process.env,
        PATH: process.env.PATH,
      },
    });

    let stdout = "";
    let stderr = "";

    // 收集输出
    codex.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    codex.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    // 超时处理
    const timeoutId = setTimeout(() => {
      codex.kill("SIGKILL");
      resolve({
        success: false,
        error: `Codex 执行超时（超过 ${timeoutMs}ms）`,
        errorCode: "CODEX_TIMEOUT",
      });
    }, timeoutMs);

    // 进程退出处理
    codex.on("close", async (code) => {
      clearTimeout(timeoutId);

      // 检查退出码
      if (code !== 0) {
        // 清理临时文件（出错时也要清理）
        try {
          await unlink(outputFile);
        } catch {
          // 忽略清理失败
        }

        // 检查是否是命令不存在
        if (code === 127 || stderr.includes("command not found") || stderr.includes("codex: not found")) {
          resolve({
            success: false,
            error: "Codex 未安装",
            errorCode: "CODEX_NOT_INSTALLED",
          });
          return;
        }

        // 检查是否是认证错误
        if (stderr.includes("401") || stderr.includes("Unauthorized") ||
            stderr.includes("not authenticated") || stderr.includes("not logged in")) {
          resolve({
            success: false,
            error: "Codex 未登录",
            errorCode: "CODEX_NOT_LOGGED_IN",
          });
          return;
        }

        // 其他错误
        resolve({
          success: false,
          error: stderr || stdout || `Codex 退出码: ${code}`,
          errorCode: "CODEX_EXEC_FAILED",
        });
        return;
      }

      // 4. 读取输出文件（codex exec 会把最终答复写到文件）
      let response = "";
      try {
        const outputContent = await readFile(outputFile);
        response = outputContent.trim();
      } catch {
        // 输出文件不存在，使用 stdout
        response = stdout.trim();
      }

      // 5. 清理临时文件（成功后也要清理）
      try {
        await unlink(outputFile);
      } catch {
        // 忽略清理失败
      }

      resolve({
        success: true,
        response,
      });
    });

    // 错误处理
    codex.on("error", async (err) => {
      clearTimeout(timeoutId);

      // 清理临时文件（出错时也要清理）
      try {
        await unlink(outputFile);
      } catch {
        // 忽略清理失败
      }

      // 检查错误类型
      const errorCode = (err as { code?: string }).code;

      if (errorCode === "ENOENT") {
        resolve({
          success: false,
          error: "Codex 未安装",
          errorCode: "CODEX_NOT_INSTALLED",
        });
      } else {
        resolve({
          success: false,
          error: err.message || "Codex 启动失败",
          errorCode: "CODEX_EXEC_FAILED",
        });
      }
    });
  });
}

/**
 * 辅助函数：读取文件内容
 */
async function readFile(filePath: string): Promise<string> {
  const { readFile: fsReadFile } = await import("node:fs/promises");
  return await fsReadFile(filePath, "utf-8");
}

/**
 * 获取 Codex 执行结果的 fixHint
 *
 * @param result Codex 执行结果
 * @returns 可执行的修复提示
 */
export function getCodexFixHint(result: CodexExecResult): string | undefined {
  if (result.success) {
    return undefined;
  }

  switch (result.errorCode) {
    case "CODEX_NOT_INSTALLED":
      return "请安装 Codex CLI: npm install -g @anthropics-ai/codex";
    case "CODEX_NOT_LOGGED_IN":
      return "请执行: codex login";
    case "CODEX_TIMEOUT":
      return "Codex 响应超时，请尝试更简单的问题或检查网络连接";
    case "CODEX_EXEC_FAILED":
      return result.error;
    default:
      return result.error || "未知错误，请检查 Codex 配置";
  }
}
