/**
 * msgcode: Schedule CLI 命令（P5.7-R5-2）
 *
 * 职责：
 * - msgcode schedule add <scheduleId> --workspace <id|path> --cron <expr> --tz <iana> --message <text>
 * - msgcode schedule list --workspace <id|path>
 * - msgcode schedule remove <scheduleId> --workspace <id|path>
 *
 * 存储：workspace/.msgcode/schedules/<scheduleId>.json
 */

import { Command } from "commander";
import path from "node:path";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { writeFile, unlink } from "node:fs/promises";
import type { Diagnostic } from "../memory/types.js";
import { parseWorkspaceParam } from "../memory/types.js";
import { getWorkspaceRootForDisplay, getActiveRoutes, type RouteEntry } from "../routes/store.js";
import { createEnvelope } from "./command-runner.js";
import {
  listSchedules,
  getSchedule,
  validateSchedule,
  scheduleToJob,
  type ScheduleFile,
  type ScheduleInfo,
} from "../config/schedules.js";
import { createHash } from "node:crypto";
import { writeFileSync, renameSync, unlinkSync } from "node:fs";
import { Cron } from "croner";
import { JobStore, getDefaultJobsPathSync } from "../jobs/store.js";

// ============================================
// 错误码定义
// ============================================

export const SCHEDULE_ERROR_CODES = {
  INVALID_CRON: "SCHEDULE_INVALID_CRON",
  NOT_FOUND: "SCHEDULE_NOT_FOUND",
  ALREADY_EXISTS: "SCHEDULE_ALREADY_EXISTS",
  WORKSPACE_NOT_FOUND: "SCHEDULE_WORKSPACE_NOT_FOUND",
  ADD_FAILED: "SCHEDULE_ADD_FAILED",
  LIST_FAILED: "SCHEDULE_LIST_FAILED",
  REMOVE_FAILED: "SCHEDULE_REMOVE_FAILED",
  ENABLE_FAILED: "SCHEDULE_ENABLE_FAILED",
  DISABLE_FAILED: "SCHEDULE_DISABLE_FAILED",
} as const;

// ============================================
// Schedule → Jobs 同步（Schedule 是真相源，Jobs 是执行投影）
// ============================================

/**
 * 原子写入文件（简化版）
 */
function atomicWrite(filePath: string, content: string): void {
  const tmpPath = `${filePath}.${Date.now()}.tmp`;
  try {
    writeFileSync(tmpPath, content, "utf-8");
    renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      unlinkSync(tmpPath);
    } catch {}
    throw err;
  }
}

/**
 * 生成稳定的 jobId（与 scheduleToJob 保持一致）
 */
function generateJobId(projectDir: string, scheduleId: string): string {
  const workspaceHash = createHash("sha256").update(projectDir).digest("hex").slice(0, 12);
  return `schedule:${workspaceHash}:${scheduleId}`;
}

/**
 * 根据 workspace 路径查找对应的 route（chatGuid）
 */
function findRouteByWorkspace(workspacePath: string): RouteEntry | null {
  const routes = getActiveRoutes();
  for (const route of routes) {
    if (route.workspacePath === workspacePath) {
      return route;
    }
  }
  return null;
}

/**
 * 将 schedule 同步到 jobs.json
 *
 * @param workspacePath 工作区路径
 * @param scheduleId Schedule ID
 * @param enabled 是否启用（用于 enable/disable 操作）
 * @returns 同步结果
 */
function syncScheduleToJobs(
  workspacePath: string,
  scheduleId: string,
  enabled?: boolean
): { success: boolean; warning?: string } {
  const jobsPath = getDefaultJobsPathSync();

  // 1. 查找 route
  const route = findRouteByWorkspace(workspacePath);
  if (!route) {
    return {
      success: false,
      warning: `工作区 ${workspacePath} 未绑定到任何群组，schedule 不会触发`,
    };
  }

  // 2. 加载 jobs.json
  let store: { version: number; jobs: unknown[] };
  if (existsSync(jobsPath)) {
    try {
      const content = readFileSync(jobsPath, "utf-8");
      store = JSON.parse(content);
    } catch {
      store = { version: 1, jobs: [] };
    }
  } else {
    store = { version: 1, jobs: [] };
  }

  // 3. 查找或创建 job
  const jobId = generateJobId(workspacePath, scheduleId);
  const existingIndex = store.jobs.findIndex(
    (j: unknown) => (j as { id: string }).id === jobId
  );

  if (enabled === undefined) {
    // add 操作：如果 job 不存在则跳过（可能在 remove 后）
    // 不自动创建，等待 scheduler 启动时重建
    return { success: true };
  }

  if (enabled) {
    // enable 操作：需要从 schedule 文件读取完整配置
    const schedule = getScheduleSync(workspacePath, scheduleId);
    if (!schedule) {
      // schedule 文件不存在，跳过
      return { success: true };
    }

    const job = scheduleToJob(schedule, route.chatGuid, workspacePath);
    job.enabled = true;

    if (existingIndex >= 0) {
      (store.jobs as unknown[])[existingIndex] = job;
    } else {
      (store.jobs as unknown[]).push(job);
    }
  } else {
    // disable 操作：标记为禁用
    if (existingIndex >= 0) {
      (store.jobs as unknown[])[existingIndex] = {
        ...((store.jobs as unknown[])[existingIndex] as { enabled: boolean }),
        enabled: false,
      };
    }
  }

  // 4. 保存
  try {
    atomicWrite(jobsPath, JSON.stringify(store, null, 2));
    return { success: true };
  } catch (err) {
    return {
      success: false,
      warning: `同步到 jobs.json 失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * 从 schedule 文件删除 job（同步删除 jobs.json）
 */
function removeScheduleFromJobs(workspacePath: string, scheduleId: string): void {
  const jobsPath = getDefaultJobsPathSync();
  if (!existsSync(jobsPath)) {
    return;
  }

  try {
    const content = readFileSync(jobsPath, "utf-8");
    const store = JSON.parse(content);
    const jobId = generateJobId(workspacePath, scheduleId);
    store.jobs = store.jobs.filter((j: unknown) => (j as { id: string }).id !== jobId);

    atomicWrite(jobsPath, JSON.stringify(store, null, 2));
  } catch {
    // 忽略删除失败
  }
}

/**
 * 同步版本的 getSchedule（用于 sync 函数）
 */
function getScheduleSync(workspacePath: string, scheduleId: string): ScheduleInfo | null {
  const schedulePath = path.join(workspacePath, ".msgcode", "schedules", `${scheduleId}.json`);
  if (!existsSync(schedulePath)) {
    return null;
  }

  try {
    const content = readFileSync(schedulePath, "utf-8");
    const schedule = JSON.parse(content) as ScheduleFile;
    return { ...schedule, id: scheduleId };
  } catch {
    return null;
  }
}

// ============================================
// 辅助函数
// ============================================

/**
 * 解析 workspace 参数为绝对路径
 */
async function resolveWorkspacePathParam(input: string): Promise<string> {
  const param = parseWorkspaceParam(input);

  if (param.kind === "id") {
    const { getRouteByChatId } = await import("../routes/store.js");
    const route = getRouteByChatId(param.value);
    if (!route) {
      throw new Error(SCHEDULE_ERROR_CODES.WORKSPACE_NOT_FOUND);
    }
    return route.workspacePath;
  } else {
    if (path.isAbsolute(param.value)) {
      return path.resolve(param.value);
    }

    const workspaceRoot = getWorkspaceRootForDisplay();
    const resolved = path.resolve(workspaceRoot, param.value);

    const relative = path.relative(workspaceRoot, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("PATH_TRAVERSAL");
    }

    return resolved;
  }
}

/**
 * 创建 Schedule 诊断信息
 */
function createScheduleDiagnostic(
  code: string,
  message: string,
  hint?: string,
  details?: Record<string, unknown>
): Diagnostic {
  const diag: Diagnostic = {
    code,
    message,
  };
  if (hint) {
    diag.hint = hint;
  }
  if (details) {
    diag.details = details;
  }
  return diag;
}

/**
 * 获取 schedules 目录路径
 */
function getSchedulesDir(workspacePath: string): string {
  return path.join(workspacePath, ".msgcode", "schedules");
}

/**
 * 获取 schedule 文件路径
 */
function getSchedulePath(workspacePath: string, scheduleId: string): string {
  return path.join(getSchedulesDir(workspacePath), `${scheduleId}.json`);
}

/**
 * 验证 cron 表达式和时区（导出供测试使用）
 */
export function validateCronExpression(cron: string, tz: string): { valid: boolean; error?: string } {
  // 验证 cron 表达式格式
  try {
    new Cron(cron);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { valid: false, error: `无效的 cron 表达式: ${message}` };
  }

  // 验证时区
  try {
    const formatter = new Intl.DateTimeFormat("en-US", { timeZone: tz });
    formatter.format();
  } catch {
    return { valid: false, error: `无效的时区: ${tz}` };
  }

  return { valid: true };
}

// ============================================
// 命令实现
// ============================================

/**
 * add 命令 - 添加 schedule
 */
export function createScheduleAddCommand(): Command {
  const cmd = new Command("add");

  cmd
    .description("添加定时调度（workspace-local）")
    .argument("<scheduleId>", "Schedule ID（用户指定）")
    .requiredOption("--workspace <id|path>", "Workspace ID、相对路径或绝对路径")
    .requiredOption("--cron <expr>", "Cron 表达式（如 '0 7 * * *'）")
    .requiredOption("--tz <iana>", "时区（如 Asia/Shanghai）")
    .requiredOption("--message <text>", "要发送的消息文本")
    .option("--max-chars <n>", "消息最大字符数（默认 2000）", "2000")
    .option("--json", "JSON 格式输出")
    .action(async (scheduleId: string, options) => {
      const startTime = Date.now();
      const command = "msgcode schedule add";
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      try {
        // 解析 workspace
        const workspacePath = await resolveWorkspacePathParam(options.workspace);

        // 校验 cron 表达式和时区（冻结要求：add 时强校验）
        const cronValidation = validateCronExpression(options.cron, options.tz);
        if (!cronValidation.valid) {
          errors.push(
            createScheduleDiagnostic(
              SCHEDULE_ERROR_CODES.INVALID_CRON,
              cronValidation.error || "无效的 cron 表达式或时区",
              "使用标准 cron 表达式（如 '0 7 * * *'）和有效的 IANA 时区（如 Asia/Shanghai）"
            )
          );
          const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);
          if (options.json) {
            console.log(JSON.stringify(envelope, null, 2));
          } else {
            console.error(`错误: ${cronValidation.error}`);
          }
          process.exit(1);
          return;
        }

        // 检查 scheduleId 是否已存在
        const existing = await getSchedule(workspacePath, scheduleId);
        if (existing) {
          errors.push(
            createScheduleDiagnostic(
              SCHEDULE_ERROR_CODES.ALREADY_EXISTS,
              `Schedule 已存在: ${scheduleId}`,
              "使用不同的 scheduleId，或先 remove 再 add"
            )
          );
          const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);
          if (options.json) {
            console.log(JSON.stringify(envelope, null, 2));
          } else {
            console.error(`错误: Schedule 已存在 (${scheduleId})`);
          }
          process.exit(1);
          return;
        }

        // 构建 schedule 文件
        const schedule: ScheduleFile = {
          version: 1,
          enabled: true,
          tz: options.tz,
          cron: options.cron,
          message: options.message,
          delivery: {
            mode: "reply-to-same-chat",
            maxChars: parseInt(options.maxChars, 10) || 2000,
          },
        };

        // 确保 schedules 目录存在
        const schedulesDir = getSchedulesDir(workspacePath);
        if (!existsSync(schedulesDir)) {
          mkdirSync(schedulesDir, { recursive: true });
        }

        // 写入文件
        const schedulePath = getSchedulePath(workspacePath, scheduleId);
        await writeFile(schedulePath, JSON.stringify(schedule, null, 2), "utf-8");

        // 同步到 jobs.json（Schedule 是真相源，Jobs 是执行投影）
        const syncResult = syncScheduleToJobs(workspacePath, scheduleId, true);
        if (syncResult.warning) {
          warnings.push(
            createScheduleDiagnostic("SCHEDULE_SYNC_WARNING", syncResult.warning)
          );
        }

        const createdAt = new Date().toISOString();
        const data = {
          scheduleId,
          cron: options.cron,
          task: options.message.slice(0, 50) + (options.message.length > 50 ? "..." : ""),
          createdAt,
          path: schedulePath,
        };

        const envelope = createEnvelope(command, startTime, "pass", data, warnings, errors);

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.log(`已添加 schedule: ${scheduleId}`);
          console.log(`  Cron: ${options.cron}`);
          console.log(`  时区: ${options.tz}`);
        }

        process.exit(0);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        if (message === SCHEDULE_ERROR_CODES.WORKSPACE_NOT_FOUND) {
          errors.push(
            createScheduleDiagnostic(
              SCHEDULE_ERROR_CODES.WORKSPACE_NOT_FOUND,
              `Workspace 不存在: ${options.workspace}`,
              "使用 msgcode routes list 查看可用的 workspace"
            )
          );
        } else {
          errors.push(
            createScheduleDiagnostic(
              SCHEDULE_ERROR_CODES.ADD_FAILED,
              `添加 schedule 失败: ${message}`,
              undefined,
              { workspace: options.workspace, scheduleId }
            )
          );
        }

        const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.error("错误:", message);
        }

        process.exit(1);
      }
    });

  return cmd;
}

/**
 * list 命令 - 列出 schedules
 */
export function createScheduleListCommand(): Command {
  const cmd = new Command("list");

  cmd
    .description("列出定时调度")
    .requiredOption("--workspace <id|path>", "Workspace ID、相对路径或绝对路径")
    .option("--json", "JSON 格式输出")
    .action(async (options) => {
      const startTime = Date.now();
      const command = "msgcode schedule list";
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      try {
        // 解析 workspace
        const workspacePath = await resolveWorkspacePathParam(options.workspace);

        // 列出所有 schedules
        const schedules = await listSchedules(workspacePath);

        const data = {
          count: schedules.length,
          items: schedules.map((s) => ({
            id: s.id,
            cron: s.cron,
            tz: s.tz,
            enabled: s.enabled,
            message: s.message.slice(0, 50) + (s.message.length > 50 ? "..." : ""),
          })),
        };

        const envelope = createEnvelope(command, startTime, "pass", data, warnings, errors);

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          if (schedules.length === 0) {
            console.log("暂无定时调度");
          } else {
            console.log(`定时调度 (${schedules.length}):`);
            for (const s of schedules) {
              const statusIcon = s.enabled ? "[x]" : "[ ]";
              console.log(`  ${statusIcon} ${s.id}`);
              console.log(`      Cron: ${s.cron} (${s.tz})`);
            }
          }
        }

        process.exit(0);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        if (message === SCHEDULE_ERROR_CODES.WORKSPACE_NOT_FOUND) {
          errors.push(
            createScheduleDiagnostic(
              SCHEDULE_ERROR_CODES.WORKSPACE_NOT_FOUND,
              `Workspace 不存在: ${options.workspace}`,
              "使用 msgcode routes list 查看可用的 workspace"
            )
          );
        } else {
          errors.push(
            createScheduleDiagnostic(
              SCHEDULE_ERROR_CODES.LIST_FAILED,
              `列出 schedule 失败: ${message}`,
              undefined,
              { workspace: options.workspace }
            )
          );
        }

        const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.error("错误:", message);
        }

        process.exit(1);
      }
    });

  return cmd;
}

/**
 * remove 命令 - 删除 schedule
 */
export function createScheduleRemoveCommand(): Command {
  const cmd = new Command("remove");

  cmd
    .description("删除定时调度")
    .argument("<scheduleId>", "Schedule ID")
    .requiredOption("--workspace <id|path>", "Workspace ID、相对路径或绝对路径")
    .option("--json", "JSON 格式输出")
    .action(async (scheduleId: string, options) => {
      const startTime = Date.now();
      const command = "msgcode schedule remove";
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      try {
        // 解析 workspace
        const workspacePath = await resolveWorkspacePathParam(options.workspace);

        // 检查 schedule 是否存在
        const existing = await getSchedule(workspacePath, scheduleId);
        if (!existing) {
          errors.push(
            createScheduleDiagnostic(
              SCHEDULE_ERROR_CODES.NOT_FOUND,
              `Schedule 不存在: ${scheduleId}`,
              "使用 msgcode schedule list 查看所有 schedule"
            )
          );
          const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);
          if (options.json) {
            console.log(JSON.stringify(envelope, null, 2));
          } else {
            console.error(`错误: Schedule 不存在 (${scheduleId})`);
          }
          process.exit(1);
          return;
        }

        // 删除文件
        const schedulePath = getSchedulePath(workspacePath, scheduleId);
        await unlink(schedulePath);

        // 同步从 jobs.json 删除
        removeScheduleFromJobs(workspacePath, scheduleId);

        const removedAt = new Date().toISOString();
        const data = {
          scheduleId,
          removedAt,
        };

        const envelope = createEnvelope(command, startTime, "pass", data, warnings, errors);

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.log(`已删除 schedule: ${scheduleId}`);
        }

        process.exit(0);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        if (message === SCHEDULE_ERROR_CODES.WORKSPACE_NOT_FOUND) {
          errors.push(
            createScheduleDiagnostic(
              SCHEDULE_ERROR_CODES.WORKSPACE_NOT_FOUND,
              `Workspace 不存在: ${options.workspace}`,
              "使用 msgcode routes list 查看可用的 workspace"
            )
          );
        } else {
          errors.push(
            createScheduleDiagnostic(
              SCHEDULE_ERROR_CODES.REMOVE_FAILED,
              `删除 schedule 失败: ${message}`,
              undefined,
              { workspace: options.workspace, scheduleId }
            )
          );
        }

        const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.error("错误:", message);
        }

        process.exit(1);
      }
    });

  return cmd;
}

// ============================================
// Schedule 命令组
// ============================================

/**
 * enable 命令 - 启用 schedule
 */
export function createScheduleEnableCommand(): Command {
  const cmd = new Command("enable");

  cmd
    .description("启用定时调度")
    .argument("<scheduleId>", "Schedule ID")
    .requiredOption("--workspace <id|path>", "Workspace ID、相对路径或绝对路径")
    .option("--json", "JSON 格式输出")
    .action(async (scheduleId: string, options) => {
      const startTime = Date.now();
      const command = "msgcode schedule enable";
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      try {
        const workspacePath = await resolveWorkspacePathParam(options.workspace);

        const { setScheduleEnabled } = await import("../config/schedules.js");
        const success = await setScheduleEnabled(workspacePath, scheduleId, true);

        if (!success) {
          errors.push(
            createScheduleDiagnostic(
              SCHEDULE_ERROR_CODES.NOT_FOUND,
              `Schedule 不存在: ${scheduleId}`
            )
          );
          const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);
          if (options.json) {
            console.log(JSON.stringify(envelope, null, 2));
          } else {
            console.error(`错误: Schedule 不存在 (${scheduleId})`);
          }
          process.exit(1);
          return;
        }

        // 同步到 jobs.json
        const syncResult = syncScheduleToJobs(workspacePath, scheduleId, true);
        if (syncResult.warning) {
          warnings.push(createScheduleDiagnostic("SCHEDULE_SYNC_WARNING", syncResult.warning));
        }

        const envelope = createEnvelope(command, startTime, "pass", { scheduleId }, warnings, errors);

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.log(`已启用 schedule: ${scheduleId}`);
        }

        process.exit(0);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(
          createScheduleDiagnostic("SCHEDULE_ENABLE_FAILED", `启用 schedule 失败: ${message}`)
        );
        const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);
        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.error("错误:", message);
        }
        process.exit(1);
      }
    });

  return cmd;
}

/**
 * disable 命令 - 禁用 schedule
 */
export function createScheduleDisableCommand(): Command {
  const cmd = new Command("disable");

  cmd
    .description("禁用定时调度")
    .argument("<scheduleId>", "Schedule ID")
    .requiredOption("--workspace <id|path>", "Workspace ID、相对路径或绝对路径")
    .option("--json", "JSON 格式输出")
    .action(async (scheduleId: string, options) => {
      const startTime = Date.now();
      const command = "msgcode schedule disable";
      const warnings: Diagnostic[] = [];
      const errors: Diagnostic[] = [];

      try {
        const workspacePath = await resolveWorkspacePathParam(options.workspace);

        const { setScheduleEnabled } = await import("../config/schedules.js");
        const success = await setScheduleEnabled(workspacePath, scheduleId, false);

        if (!success) {
          errors.push(
            createScheduleDiagnostic(
              SCHEDULE_ERROR_CODES.NOT_FOUND,
              `Schedule 不存在: ${scheduleId}`
            )
          );
          const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);
          if (options.json) {
            console.log(JSON.stringify(envelope, null, 2));
          } else {
            console.error(`错误: Schedule 不存在 (${scheduleId})`);
          }
          process.exit(1);
          return;
        }

        // 同步到 jobs.json
        const syncResult = syncScheduleToJobs(workspacePath, scheduleId, false);
        if (syncResult.warning) {
          warnings.push(createScheduleDiagnostic("SCHEDULE_SYNC_WARNING", syncResult.warning));
        }

        const envelope = createEnvelope(command, startTime, "pass", { scheduleId }, warnings, errors);

        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.log(`已禁用 schedule: ${scheduleId}`);
        }

        process.exit(0);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(
          createScheduleDiagnostic("SCHEDULE_DISABLE_FAILED", `禁用 schedule 失败: ${message}`)
        );
        const envelope = createEnvelope(command, startTime, "error", {}, warnings, errors);
        if (options.json) {
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          console.error("错误:", message);
        }
        process.exit(1);
      }
    });

  return cmd;
}

export function createScheduleCommand(): Command {
  const cmd = new Command("schedule");

  cmd.description("Schedule 定时调度管理（workspace-local）");

  cmd.addCommand(createScheduleAddCommand());
  cmd.addCommand(createScheduleListCommand());
  cmd.addCommand(createScheduleRemoveCommand());
  cmd.addCommand(createScheduleEnableCommand());
  cmd.addCommand(createScheduleDisableCommand());

  return cmd;
}

// ============================================
// 合同导出（help-docs 使用）
// ============================================

/**
 * 获取 schedule add 命令合同
 */
export function getScheduleAddContract() {
  return {
    name: "msgcode schedule add",
    description: "添加定时调度",
    options: {
      required: {
        "--workspace": "Workspace ID、相对路径或绝对路径",
        "--cron": "Cron 表达式（如 '0 7 * * *'）",
        "--tz": "时区（IANA 格式，如 Asia/Shanghai）",
        "--message": "要发送的消息文本",
      },
      optional: {
        "--max-chars": "消息最大字符数（默认 2000）",
        "--json": "JSON 格式输出",
      },
    },
    output: {
      scheduleId: "Schedule ID",
      cron: "Cron 表达式",
      task: "任务描述（截断预览）",
      createdAt: "创建时间（ISO 8601）",
    },
    errorCodes: [
      "SCHEDULE_INVALID_CRON",
      "SCHEDULE_ALREADY_EXISTS",
      "SCHEDULE_WORKSPACE_NOT_FOUND",
      "SCHEDULE_ADD_FAILED",
    ],
  };
}

/**
 * 获取 schedule list 命令合同
 */
export function getScheduleListContract() {
  return {
    name: "msgcode schedule list",
    description: "列出定时调度",
    options: {
      required: {
        "--workspace": "Workspace ID、相对路径或绝对路径",
      },
      optional: {
        "--json": "JSON 格式输出",
      },
    },
    output: {
      count: "Schedule 数量",
      items: "Schedule 列表",
    },
    errorCodes: [
      "SCHEDULE_WORKSPACE_NOT_FOUND",
      "SCHEDULE_LIST_FAILED",
    ],
  };
}

/**
 * 获取 schedule remove 命令合同
 */
export function getScheduleRemoveContract() {
  return {
    name: "msgcode schedule remove",
    description: "删除定时调度",
    options: {
      required: {
        "--workspace": "Workspace ID、相对路径或绝对路径",
      },
      optional: {
        "--json": "JSON 格式输出",
      },
    },
    output: {
      scheduleId: "Schedule ID",
      removedAt: "删除时间（ISO 8601）",
    },
    errorCodes: [
      "SCHEDULE_NOT_FOUND",
      "SCHEDULE_WORKSPACE_NOT_FOUND",
      "SCHEDULE_REMOVE_FAILED",
    ],
  };
}

/**
 * 获取 schedule enable 命令合同
 */
export function getScheduleEnableContract() {
  return {
    name: "msgcode schedule enable",
    description: "启用定时调度",
    options: {
      required: {
        "--workspace": "Workspace ID、相对路径或绝对路径",
      },
      optional: {
        "--json": "JSON 格式输出",
      },
    },
    output: {
      scheduleId: "Schedule ID",
    },
    errorCodes: [
      "SCHEDULE_NOT_FOUND",
      "SCHEDULE_WORKSPACE_NOT_FOUND",
      "SCHEDULE_ENABLE_FAILED",
    ],
  };
}

/**
 * 获取 schedule disable 命令合同
 */
export function getScheduleDisableContract() {
  return {
    name: "msgcode schedule disable",
    description: "禁用定时调度",
    options: {
      required: {
        "--workspace": "Workspace ID、相对路径或绝对路径",
      },
      optional: {
        "--json": "JSON 格式输出",
      },
    },
    output: {
      scheduleId: "Schedule ID",
    },
    errorCodes: [
      "SCHEDULE_NOT_FOUND",
      "SCHEDULE_WORKSPACE_NOT_FOUND",
      "SCHEDULE_DISABLE_FAILED",
    ],
  };
}
