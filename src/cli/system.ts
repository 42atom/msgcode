/**
 * msgcode: System CLI 命令（P5.7-R2 + R3-4）
 *
 * 职责：
 * - msgcode system info [--json]：系统信息
 * - msgcode system env [--name] [--json]：环境变量查询
 */

import { Command } from "commander";
import { randomUUID } from "node:crypto";
import type { Envelope, Diagnostic } from "../memory/types.js";
import os from "node:os";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";

const execAsync = promisify(exec);

// ============================================
// 类型定义
// ============================================

interface SystemInfoData {
  ok: boolean;
  infoResult: "OK" | "INFO_FAILED";
  hostname?: string;
  platform?: string;
  arch?: string;
  cpus?: number;
  memory?: { total: number; free: number; used: number };
  nodeVersion?: string;
  homeDir?: string;
  configPath?: string;
  errorMessage?: string;
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
// System Info 命令实现
// ============================================

/**
 * 创建 system info 子命令
 */
export function createSystemInfoCommand(): Command {
  const cmd = new Command("info");

  cmd
    .description("显示系统信息")
    .option("--json", "JSON 格式输出")
    .action(async (options) => {
      const startTime = Date.now();
      const command = "msgcode system info";
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      try {
        // 收集系统信息
        const hostname = os.hostname();
        const platform = os.platform();
        const arch = os.arch();
        const cpus = os.cpus().length;
        const totalMemory = os.totalmem();
        const freeMemory = os.freemem();
        const usedMemory = totalMemory - freeMemory;
        const nodeVersion = process.version;
        const homeDir = homedir();
        const configPath = join(homeDir, ".config/msgcode");
        const configExists = existsSync(configPath);

        // 尝试获取额外信息（可选）
        let workspaceRoot: string | undefined;
        try {
          const { config } = await import("../config.js");
          workspaceRoot = config.workspaceRoot;
        } catch {
          // 可选信息，缺失不影响
        }

        const data: SystemInfoData = {
          ok: true,
          infoResult: "OK",
          hostname,
          platform,
          arch,
          cpus,
          memory: {
            total: totalMemory,
            free: freeMemory,
            used: usedMemory,
          },
          nodeVersion,
          homeDir,
          configPath,
        };

        const envelope = createEnvelope<SystemInfoData>(
          command,
          startTime,
          "pass",
          data,
          warnings,
          errors
        );

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.log(`系统信息:`);
          console.log(`  主机名：${hostname}`);
          console.log(`  平台：${platform} ${arch}`);
          console.log(`  CPU: ${cpus} 核心`);
          console.log(`  内存：${(totalMemory / 1024 / 1024 / 1024).toFixed(2)} GB (可用：${(freeMemory / 1024 / 1024 / 1024).toFixed(2)} GB)`);
          console.log(`  Node: ${nodeVersion}`);
          console.log(`  家目录：${homeDir}`);
          console.log(`  配置：${configPath} ${configExists ? "✓" : "✗ (不存在)"}`);
          if (workspaceRoot) {
            console.log(`  工作区：${workspaceRoot}`);
          }
        }

        process.exit(0);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({
          code: "SYSTEM_INFO_FAILED",
          message: `系统信息获取失败：${message}`,
        });

        const envelope = createEnvelope<SystemInfoData>(
          command,
          startTime,
          "error",
          {
            ok: false,
            infoResult: "INFO_FAILED",
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
// System Env 命令实现（P5.7-R3-4）
// ============================================

/**
 * 创建 system env 子命令（P5.7-R3-4：环境变量查询）
 */
export function createSystemEnvCommand(): Command {
  const cmd = new Command("env");

  cmd
    .description("查询环境变量（P5.7-R3-4）")
    .option("--name <name>", "指定变量名（默认返回所有）")
    .option("--json", "JSON 格式输出")
    .action((options) => {
      const startTime = Date.now();
      const command = options.name
        ? `msgcode system env --name ${options.name}`
        : "msgcode system env";
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      try {
        if (options.name) {
          // 查询单个变量
          const value = process.env[options.name];

          if (value === undefined) {
            errors.push({
              code: "SYSTEM_ENV_NOT_FOUND",
              message: `环境变量不存在：${options.name}`,
            });
            const envelope = createEnvelope(
              command,
              startTime,
              "error",
              {
                ok: false,
                envResult: "NOT_FOUND" as const,
                errorCode: "VARIABLE_NOT_FOUND",
                errorMessage: `环境变量不存在：${options.name}`,
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

          // 成功
          const envelope = createEnvelope(
            command,
            startTime,
            "pass",
            {
              ok: true,
              envResult: "OK" as const,
              name: options.name,
              value,
            },
            warnings,
            errors
          );

          if (options.json) {
            console.log(JSON.stringify(envelope, null, 2));
          } else {
            console.log(`${options.name}=${value}`);
          }
        } else {
          // 返回所有环境变量
          const env = { ...process.env };

          const envelope = createEnvelope(
            command,
            startTime,
            "pass",
            {
              ok: true,
              envResult: "OK" as const,
              count: Object.keys(env).length,
              variables: env,
            },
            warnings,
            errors
          );

          if (options.json) {
            console.log(JSON.stringify(envelope, null, 2));
          } else {
            console.log(`环境变量 (${Object.keys(env).length} 个):`);
            Object.entries(env).forEach(([key, value]) => {
              console.log(`  ${key}=${value || ''}`);
            });
          }
        }

        process.exit(0);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({
          code: "SYSTEM_ENV_UNEXPECTED_ERROR",
          message: `查询失败：${message}`,
        });

        const envelope = createEnvelope(
          command,
          startTime,
          "error",
          {
            ok: false,
            envResult: "FAILED" as const,
            errorCode: "QUERY_ERROR",
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

/**
 * 创建 system 命令组
 */
export function createSystemCommand(): Command {
  const sysCmd = new Command("system");

  sysCmd.description("系统操作");
  sysCmd.addCommand(createSystemInfoCommand());
  sysCmd.addCommand(createSystemEnvCommand());

  return sysCmd;
}

/**
 * 导出 system 命令合同（供 help-docs --json 使用）
 */
export function getSystemCommandContract() {
  return [
    {
      name: "system info",
      description: "显示系统信息",
      options: {
        optional: {
          "--json": "JSON 格式输出",
        },
      },
      output: {
        success: {
          ok: true,
          infoResult: "OK",
          hostname: "<主机名>",
          platform: "<平台>",
          arch: "<架构>",
          cpus: "<CPU 核心数>",
          memory: {
            total: "<总内存 (字节)>",
            free: "<可用内存 (字节)>",
            used: "<已用内存 (字节)>",
          },
          nodeVersion: "<Node 版本>",
          homeDir: "<家目录>",
          configPath: "<配置路径>",
        },
        infoFailed: {
          ok: false,
          infoResult: "INFO_FAILED",
          errorMessage: "<错误信息>",
        },
      },
      errorCodes: ["OK", "INFO_FAILED"],
    },
    {
      name: "system env",
      description: "查询环境变量（P5.7-R3-4）",
      options: {
        optional: {
          "--name <name>": "指定变量名（默认返回所有）",
          "--json": "JSON 格式输出",
        },
      },
      output: {
        success: {
          ok: true,
          envResult: "OK",
          name: "<变量名>",
          value: "<变量值>",
        },
        notFound: {
          ok: false,
          envResult: "NOT_FOUND",
          errorCode: "VARIABLE_NOT_FOUND",
          errorMessage: "<错误信息>",
        },
        failed: {
          ok: false,
          envResult: "FAILED",
          errorCode: "QUERY_ERROR",
          errorMessage: "<错误信息>",
        },
      },
      errorCodes: ["OK", "NOT_FOUND", "FAILED"],
    },
  ];
}
