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
import { getMemoryAddContract, getMemoryIndexContract, getMemorySearchContract, getMemoryGetContract, getMemoryStatsContract } from "./memory.js";
import { getThreadListContract, getThreadMessagesContract, getThreadActiveContract, getThreadSwitchContract } from "./thread.js";
import { getInboxAddContract, getInboxConsumeWebContract } from "./inbox.js";
import { getStatusLogAddContract, getStatusLogTailContract } from "./status-log.js";
import { getTodoAddContract, getTodoListContract, getTodoDoneContract } from "./todo.js";
import { getScheduleAddContract, getScheduleListContract, getScheduleRemoveContract, getScheduleEnableContract, getScheduleDisableContract, getScheduleMigrateV1ToV2Contract } from "./schedule.js";
import { getGenImageContract, getGenSelfieContract } from "./gen-image.js";
import { getGenTtsContract, getGenMusicContract } from "./gen-audio.js";
import { getBrowserCommandContracts } from "./browser.js";
import { getSubagentRunContract, getSubagentSayContract, getSubagentListContract, getSubagentStatusContract, getSubagentStopContract } from "./subagent.js";
import { getGhostPermissionsContract } from "./ghost.js";

// ============================================
// 类型定义
// ============================================

export interface HelpCommandContract {
  name: string;
  description: string;
  aliases?: string[];
  options?: {
    required?: Record<string, string>;
    optional?: Record<string, string>;
  };
  output?: Record<string, unknown>;
  errorCodes?: string[];
  constraints?: Record<string, unknown>;
}

export interface HelpData {
  version: string;
  totalCommands: number;
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
        const data = await getHelpDocsData();

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
          const version = data.version;
          const commands = data.commands;
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

            if (Array.isArray((command as { aliases?: string[] }).aliases) && (command as { aliases?: string[] }).aliases!.length > 0) {
              console.log(`    兼容别名：${(command as { aliases?: string[] }).aliases!.join(", ")}`);
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

function getAllHelpCommandContracts(): Record<string, unknown>[] {
  return [
    // Memory 命令组（P5.7-R4-1）
    getMemoryAddContract() as Record<string, unknown>,
    getMemoryIndexContract() as Record<string, unknown>,
    getMemorySearchContract() as Record<string, unknown>,
    getMemoryGetContract() as Record<string, unknown>,
    getMemoryStatsContract() as Record<string, unknown>,
    // Thread 命令组（P5.7-R4-2）
    getThreadListContract() as Record<string, unknown>,
    getThreadMessagesContract() as Record<string, unknown>,
    getThreadActiveContract() as Record<string, unknown>,
    getThreadSwitchContract() as Record<string, unknown>,
    getInboxAddContract() as Record<string, unknown>,
    getInboxConsumeWebContract() as Record<string, unknown>,
    getStatusLogAddContract() as Record<string, unknown>,
    getStatusLogTailContract() as Record<string, unknown>,
    // Todo 命令组（P5.7-R5-1）
    getTodoAddContract() as Record<string, unknown>,
    getTodoListContract() as Record<string, unknown>,
    getTodoDoneContract() as Record<string, unknown>,
    // Schedule 命令组（P5.7-R5-2）
    getScheduleAddContract() as Record<string, unknown>,
    getScheduleListContract() as Record<string, unknown>,
    getScheduleRemoveContract() as Record<string, unknown>,
    getScheduleEnableContract() as Record<string, unknown>,
    getScheduleDisableContract() as Record<string, unknown>,
    getScheduleMigrateV1ToV2Contract() as Record<string, unknown>,
    // Gen Image 命令组（P5.7-R6-2）
    getGenImageContract() as Record<string, unknown>,
    getGenSelfieContract() as Record<string, unknown>,
    // Gen Audio 命令组（P5.7-R6-3）
    getGenTtsContract() as Record<string, unknown>,
    getGenMusicContract() as Record<string, unknown>,
    // Browser 命令组（P5.7-R7A）
    ...(getBrowserCommandContracts() as Record<string, unknown>[]),
    // Ghost 命令（ghost-os 权限事实）
    getGhostPermissionsContract() as Record<string, unknown>,
    // Subagent 命令组（P5.7-R36）
    getSubagentRunContract() as Record<string, unknown>,
    getSubagentSayContract() as Record<string, unknown>,
    getSubagentListContract() as Record<string, unknown>,
    getSubagentStatusContract() as Record<string, unknown>,
    getSubagentStopContract() as Record<string, unknown>,
  ];
}

export async function getHelpDocsData(params?: {
  query?: string;
  limit?: number;
}): Promise<HelpData> {
  const { getVersion } = await import("../version.js");
  const version = getVersion();
  const normalizedQuery = (params?.query || "").trim().toLowerCase();
  const rawCommands = getAllHelpCommandContracts();
  const commands = normalizedQuery
    ? rawCommands.filter((item) => {
        const name = typeof item?.name === "string" ? item.name.toLowerCase() : "";
        const description = typeof item?.description === "string" ? item.description.toLowerCase() : "";
        return name.includes(normalizedQuery) || description.includes(normalizedQuery);
      })
    : rawCommands;
  const limitedCommands = typeof params?.limit === "number" && Number.isFinite(params.limit) && params.limit > 0
    ? commands.slice(0, Math.floor(params.limit))
    : commands;

  return {
    version,
    totalCommands: rawCommands.length,
    commands: limitedCommands,
  };
}
