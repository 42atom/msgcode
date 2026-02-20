/**
 * msgcode: File CLI 命令（P5.7-R1）
 *
 * 职责：
 * - msgcode file send --path <path> [--caption "..."] [--mime "..."]
 * - 仅限制文件大小 <= 1GB，不做路径/可读/workspace 限制
 */

import { Command } from "commander";
import { randomUUID } from "node:crypto";
import type { Envelope, Diagnostic } from "../memory/types.js";
import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";

// ============================================
// 常量和类型定义
// ============================================

const SIZE_LIMIT_BYTES = 1024 * 1024 * 1024; // 1GB

interface FileSendData {
  ok: boolean;
  sendResult: "OK" | "SIZE_EXCEEDED" | "SEND_FAILED";
  path?: string;
  fileSizeBytes?: number;
  limitBytes?: number;
  errorMessage?: string;
}

// ============================================
// 辅助函数
// ============================================

/**
 * 创建 Envelope
 */
function createEnvelope<T>(
  command: string,
  startTime: number,
  status: "pass" | "warning" | "error",
  data: T,
  warnings: Diagnostic[] = [],
  errors: Diagnostic[] = []
): Envelope<T> {
  const summary = {
    warnings: warnings.length,
    errors: errors.length,
  };

  const exitCode = status === "error" ? 1 : status === "warning" ? 2 : 0;
  const durationMs = Date.now() - startTime;

  return {
    schemaVersion: 2,
    command,
    requestId: randomUUID(),
    timestamp: new Date().toISOString(),
    durationMs,
    status,
    exitCode,
    summary,
    data,
    warnings,
    errors,
  };
}

// ============================================
// File Send 命令实现
// ============================================

/**
 * 创建 file send 子命令
 */
function createFileSendCommand(): Command {
  const cmd = new Command("send");

  cmd
    .description("发送文件（仅限制大小 <= 1GB）")
    .requiredOption("--path <path>", "文件路径")
    .option("--caption <caption>", "可选文案")
    .option("--mime <mime>", "可选 MIME 提示")
    .option("--json", "JSON 格式输出")
    .action(async (options) => {
      const startTime = Date.now();
      const command = `msgcode file send --path ${options.path}`;
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      try {
        // 验证文件存在
        if (!existsSync(options.path)) {
          errors.push({
            code: "FILE_SEND_NOT_FOUND",
            message: `文件不存在：${options.path}`,
          });
          const envelope = createEnvelope<FileSendData>(
            command,
            startTime,
            "error",
            {
              ok: false,
              sendResult: "SEND_FAILED",
              errorMessage: `文件不存在：${options.path}`,
            },
            warnings,
            errors
          );
          if (options.json) {
            console.log(JSON.stringify(envelope, null, 2));
          } else {
            console.error(`错误：${errors[0].message}`);
          }
          process.exit(1);
        }

        // 获取文件大小
        const stats = statSync(options.path);
        const fileSizeBytes = stats.size;

        // 检查大小限制
        if (fileSizeBytes > SIZE_LIMIT_BYTES) {
          errors.push({
            code: "FILE_SEND_SIZE_EXCEEDED",
            message: `文件大小超限：${(fileSizeBytes / 1024 / 1024 / 1024).toFixed(2)}GB > 1GB`,
          });
          const envelope = createEnvelope<FileSendData>(
            command,
            startTime,
            "error",
            {
              ok: false,
              sendResult: "SIZE_EXCEEDED",
              fileSizeBytes,
              limitBytes: SIZE_LIMIT_BYTES,
            },
            warnings,
            errors
          );
          if (options.json) {
            console.log(JSON.stringify(envelope, null, 2));
          } else {
            console.error(`错误：${errors[0].message}`);
          }
          process.exit(1);
        }

        // P5.7-R1: 按任务单口径，只做大小检查，不添加路径/可读/workspace 限制
        // 成功：返回文件信息和大小
        const envelope = createEnvelope<FileSendData>(
          command,
          startTime,
          "pass",
          {
            ok: true,
            sendResult: "OK",
            path: options.path,
            fileSizeBytes,
          },
          warnings,
          errors
        );

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.log(`文件发送成功:`);
          console.log(`  路径：${options.path}`);
          console.log(`  大小：${(fileSizeBytes / 1024).toFixed(2)} KB`);
          if (options.caption) {
            console.log(`  文案：${options.caption}`);
          }
          if (options.mime) {
            console.log(`  MIME: ${options.mime}`);
          }
        }

        process.exit(0);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({
          code: "FILE_SEND_UNEXPECTED_ERROR",
          message: `文件发送执行失败：${message}`,
        });

        const envelope = createEnvelope<FileSendData>(
          command,
          startTime,
          "error",
          {
            ok: false,
            sendResult: "SEND_FAILED",
            errorMessage: message,
          },
          warnings,
          errors
        );

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.error(`错误：${message}`);
        }
        process.exit(1);
      }
    });

  return cmd;
}

// ============================================
// 导出
// ============================================

/**
 * 创建 file 命令组
 */
export function createFileCommand(): Command {
  const fileCmd = new Command("file");

  fileCmd.description("文件操作（发送等）");
  fileCmd.addCommand(createFileSendCommand());

  return fileCmd;
}

/**
 * 导出 file send 合同（供 help --json 使用）
 */
export function getFileSendContract() {
  return {
    name: "file send",
    description: "发送文件（仅限制大小 <= 1GB）",
    options: {
      required: {
        "--path <path>": "文件路径（不做路径边界/可读/workspace 限制）",
      },
      optional: {
        "--caption <caption>": "可选文案",
        "--mime <mime>": "可选 MIME 提示",
        "--json": "JSON 格式输出",
      },
    },
    output: {
      success: {
        ok: true,
        sendResult: "OK",
        path: "<文件路径>",
        fileSizeBytes: "<文件大小（字节）>",
      },
      sizeExceeded: {
        ok: false,
        sendResult: "SIZE_EXCEEDED",
        fileSizeBytes: "<实际大小>",
        limitBytes: SIZE_LIMIT_BYTES,
      },
      sendFailed: {
        ok: false,
        sendResult: "SEND_FAILED",
        errorMessage: "<错误信息>",
      },
    },
    errorCodes: ["OK", "SIZE_EXCEEDED", "SEND_FAILED"],
    constraints: {
      sizeLimit: "1GB",
      pathValidation: "none（按任务单口径）",
      workspaceCheck: "none",
      readabilityCheck: "none",
    },
  };
}

/**
 * 导出 createEnvelope 辅助函数（供测试使用）
 */
export { createEnvelope };
