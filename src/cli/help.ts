/**
 * msgcode: Help CLI 命令（P5.7-R1）
 *
 * 职责：
 * - msgcode help-docs [--json]：机器可读帮助
 * - 输出所有可用命令的合同信息
 */

import { Command } from "commander";
import { randomUUID } from "node:crypto";
import type { Envelope, Diagnostic } from "../memory/types.js";
import { getFileSendContract, getFileFindContract, getFileReadContract, getFileWriteContract, getFileDeleteContract, getFileMoveContract, getFileCopyContract } from "./file.js";
import { getWebCommandContract } from "./web.js";
import { getSystemCommandContract } from "./system.js";

// ============================================
// 类型定义
// ============================================

interface HelpCommandContract {
  name: string;
  description: string;
  options?: {
    required?: Record<string, string>;
    optional?: Record<string, string>;
  };
  output?: Record<string, unknown>;
  errorCodes?: string[];
  constraints?: Record<string, unknown>;
}

interface HelpData {
  version: string;
  commands: Record<string, unknown>[];
}

// ============================================
// 辅助函数
// ============================================

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
// Help 命令实现
// ============================================

/**
 * 创建 help-docs 命令（避免与 commander 内置 help 冲突）
 */
export function createHelpDocsCommand(): Command {
  const cmd = new Command("help-docs");

  cmd
    .description("查看可用命令帮助（支持 --json 机器可读）")
    .option("--json", "JSON 格式输出（机器可读）")
    .action(async (options) => {
      const startTime = Date.now();
      const command = "msgcode help-docs";
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      try {
        // 获取版本
        const { getVersion } = await import("../version.js");
        const version = getVersion();

        // 构建命令合同列表
        const commands: Record<string, unknown>[] = [
          // File 命令组（P5.7-R1b + R3-1/R3-2/R3-3）
          getFileSendContract() as Record<string, unknown>,
          getFileFindContract() as Record<string, unknown>,
          getFileReadContract() as Record<string, unknown>,
          getFileWriteContract() as Record<string, unknown>,
          getFileDeleteContract() as Record<string, unknown>,
          getFileMoveContract() as Record<string, unknown>,
          getFileCopyContract() as Record<string, unknown>,
          // Web 命令组（P5.7-R2）
          ...(getWebCommandContract() as Record<string, unknown>[]),
          // System 命令组（P5.7-R2 + R3-4）
          ...(getSystemCommandContract() as Record<string, unknown>[]),
        ];

        const data: HelpData = {
          version,
          commands,
        };

        if (options.json) {
          const envelope = createEnvelope<HelpData>(
            command,
            startTime,
            "pass",
            data,
            warnings,
            errors
          );
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          // 文本格式帮助
          console.log(`msgcode help-docs v${version}`);
          console.log("");
          console.log("可用命令:");
          console.log("");

          for (const cmd of commands) {
            const command = cmd as {
              name: string;
              description: string;
              options?: {
                required?: Record<string, string>;
                optional?: Record<string, string>;
              };
              errorCodes?: string[];
            };

            console.log(`  ${command.name}`);
            console.log(`    ${command.description}`);

            if (command.options?.required) {
              console.log("    必填参数:");
              for (const [opt, desc] of Object.entries(command.options.required)) {
                console.log(`      ${opt}: ${desc}`);
              }
            }

            if (command.options?.optional) {
              console.log("    可选参数:");
              for (const [opt, desc] of Object.entries(command.options.optional)) {
                console.log(`      ${opt}: ${desc}`);
              }
            }

            if (command.errorCodes) {
              console.log(`    错误码：${command.errorCodes.join(", ")}`);
            }

            console.log("");
          }

          console.log("使用 --json 获取机器可读格式");
        }

        process.exit(0);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({
          code: "HELP_UNEXPECTED_ERROR",
          message: `帮助命令执行失败：${message}`,
        });

        const envelope = createEnvelope<null>(
          command,
          startTime,
          "error",
          null,
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
