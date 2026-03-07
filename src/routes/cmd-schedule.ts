/**
 * msgcode: 业务域命令（schedule/reload）
 */

import { join } from "node:path";
import type { CommandHandlerOptions, CommandResult } from "./cmd-types.js";
import { resolveCommandRoute } from "./workspace-resolver.js";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { Cron } from "croner";
import { getDefaultJobsPathSync } from "../jobs/store.js";
import { getRouteByChatId } from "../routes/store.js";

export async function handleScheduleListCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  const entry = resolveCommandRoute(options.chatId)?.route;
  if (!entry) {
    return {
      success: false,
      message: `未绑定工作区，请先使用 /bind <dir> 绑定工作区`,
    };
  }

  const { listSchedules } = await import("../config/schedules.js");
  const schedules = await listSchedules(entry.workspacePath);

  if (schedules.length === 0) {
    return {
      success: true,
      message: `当前工作区暂无 schedules\n` +
        `\n` +
        `创建方法：在 ${entry.workspacePath}/.msgcode/schedules/ 目录下创建 .json 文件\n` +
        `格式参考:\n` +
        `{\n` +
        `  "version": 1,\n` +
        `  "enabled": true,\n` +
        `  "tz": "Asia/Shanghai",\n` +
        `  "cron": "0 9 * * 1-5",\n` +
        `  "message": "工作日早上9点提醒",\n` +
        `  "delivery": { "mode": "reply-to-same-chat", "maxChars": 2000 }\n` +
        `}`,
    };
  }

  const lines: string[] = [`Schedules (${schedules.length})`];
  for (const schedule of schedules) {
    const status = schedule.enabled ? "✓" : "✗";
    lines.push(`${status} ${schedule.id} - ${schedule.cron} (${schedule.tz})`);
  }

  lines.push(`\n使用 /schedule validate 验证所有 schedules`);
  lines.push(`使用 /schedule enable <id> 启用 schedule`);
  lines.push(`使用 /schedule disable <id> 禁用 schedule`);

  return {
    success: true,
    message: lines.join("\n"),
  };
}

// ============================================
// P5.7-R13: Schedule 双入口统一（add/remove）
// ============================================

/**
 * 验证 cron 表达式和时区
 */
function validateCronExpression(cron: string, tz: string): { valid: boolean; error?: string } {
  try {
    new Cron(cron);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { valid: false, error: `无效的 cron 表达式：${message}` };
  }

  try {
    const formatter = new Intl.DateTimeFormat("en-US", { timeZone: tz });
    formatter.format();
  } catch {
    return { valid: false, error: `无效的时区：${tz}` };
  }

  return { valid: true };
}

/**
 * 生成稳定的 jobId（与 CLI 保持一致）
 */
function generateJobId(projectDir: string, scheduleId: string): string {
  const workspaceHash = createHash("sha256").update(projectDir).digest("hex").slice(0, 12);
  return `schedule:${workspaceHash}:${scheduleId}`;
}

/**
 * 原子写入文件
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
 * 从 jobs.json 删除 schedule 投影
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
 * 同步 schedule 到 jobs.json
 */
function syncScheduleToJobs(
  workspacePath: string,
  scheduleId: string,
  cron: string,
  tz: string,
  message: string,
  chatGuid: string,
  enabled: boolean
): { success: boolean; warning?: string } {
  const jobsPath = getDefaultJobsPathSync();
  const route = getRouteByChatId(chatGuid);
  if (!route) {
    return {
      success: false,
      warning: `工作区 ${workspacePath} 未绑定到任何群组，schedule 不会触发`,
    };
  }

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

  const jobId = generateJobId(workspacePath, scheduleId);
  const existingIndex = store.jobs.findIndex(
    (j: unknown) => (j as { id: string }).id === jobId
  );

  const job = {
    id: jobId,
    type: "schedule" as const,
    enabled,
    route: route.chatGuid,
    workspace: workspacePath,
    schedule: {
      id: scheduleId,
      cron,
      tz,
      message,
      delivery: { mode: "reply-to-same-chat" as const, maxChars: 2000 },
    },
  };

  if (existingIndex >= 0) {
    (store.jobs as unknown[])[existingIndex] = job;
  } else {
    (store.jobs as unknown[]).push(job);
  }

  try {
    atomicWrite(jobsPath, JSON.stringify(store, null, 2));
    return { success: true };
  } catch (err) {
    return {
      success: false,
      warning: `同步到 jobs.json 失败：${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * 解析 workspace 参数（支持 ID/相对路径/绝对路径）
 */
async function resolveWorkspacePathParam(input: string, chatGuid: string): Promise<string> {
  // 尝试作为 workspace ID 解析
  const route = getRouteByChatId(chatGuid);
  if (route && route.workspacePath === input) {
    return route.workspacePath;
  }

  // 尝试作为相对路径
  if (!input.startsWith("/")) {
    const route = getRouteByChatId(chatGuid);
    if (route) {
      return join(route.workspacePath, input);
    }
  }

  // 绝对路径
  if (input.startsWith("/")) {
    return input;
  }

  throw new Error("SCHEDULE_WORKSPACE_NOT_FOUND");
}

export async function handleScheduleAddCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  const args = options.args;
  if (args.length < 5) {
    return {
      success: false,
      message: `用法：/schedule add <scheduleId> --workspace <id|path> --cron <expr> --tz <iana> --message <text>\n` +
        `\n` +
        `参数说明:\n` +
        `  <scheduleId>  Schedule ID（用户指定）\n` +
        `  --workspace   Workspace ID、相对路径或绝对路径\n` +
        `  --cron        Cron 表达式（如 '0 7 * * *'）\n` +
        `  --tz          时区（如 Asia/Shanghai）\n` +
        `  --message     要发送的消息文本\n` +
        `\n` +
        `使用 /schedule list 查看已有的 schedules`,
    };
  }

  const scheduleId = args[0];
  const workspaceIdx = args.indexOf("--workspace");
  const cronIdx = args.indexOf("--cron");
  const tzIdx = args.indexOf("--tz");
  const messageIdx = args.indexOf("--message");

  if (workspaceIdx === -1 || cronIdx === -1 || tzIdx === -1 || messageIdx === -1) {
    return {
      success: false,
      message: `用法：/schedule add <scheduleId> --workspace <id|path> --cron <expr> --tz <iana> --message <text>\n` +
        `\n` +
        `缺少必填参数`,
    };
  }

  const workspaceInput = args[workspaceIdx + 1];
  const cron = args[cronIdx + 1];
  const tz = args[tzIdx + 1];
  const message = args.slice(messageIdx + 1).join(" ");

  if (!workspaceInput || !cron || !tz || !message) {
    return {
      success: false,
      message: `用法：/schedule add <scheduleId> --workspace <id|path> --cron <expr> --tz <iana> --message <text>\n` +
        `\n` +
        `参数值不能为空`,
    };
  }

  const entry = resolveCommandRoute(options.chatId)?.route;
  if (!entry) {
    return {
      success: false,
      message: `未绑定工作区，请先使用 /bind <dir> 绑定工作区`,
    };
  }

  try {
    const workspacePath = await resolveWorkspacePathParam(workspaceInput, options.chatId);

    // 验证 cron 表达式和时区
    const cronValidation = validateCronExpression(cron, tz);
    if (!cronValidation.valid) {
      return {
        success: false,
        message: `错误：${cronValidation.error}`,
      };
    }

    // 检查 schedule 是否已存在
    const { getSchedule } = await import("../config/schedules.js");
    const existing = await getSchedule(workspacePath, scheduleId);
    if (existing) {
      return {
        success: false,
        message: `错误：Schedule 已存在 (${scheduleId})\n` +
          `\n` +
          `使用不同的 scheduleId，或先 remove 再 add`,
      };
    }

    // 构建 schedule 文件
    const schedule = {
      version: 1 as const,
      enabled: true,
      tz,
      cron,
      message,
      delivery: {
        mode: "reply-to-same-chat" as const,
        maxChars: 2000,
      },
    };

    // 确保 schedules 目录存在
    const schedulesDir = join(workspacePath, ".msgcode", "schedules");
    if (!existsSync(schedulesDir)) {
      mkdirSync(schedulesDir, { recursive: true });
    }

    // 写入文件
    const schedulePath = join(schedulesDir, `${scheduleId}.json`);
    writeFileSync(schedulePath, JSON.stringify(schedule, null, 2), "utf-8");

    // 同步到 jobs.json
    const syncResult = syncScheduleToJobs(
      workspacePath,
      scheduleId,
      cron,
      tz,
      message,
      options.chatId,
      true
    );

    let resultMessage = `已添加 schedule: ${scheduleId}\n` +
      `  Cron: ${cron}\n` +
      `  时区：${tz}\n` +
      `  消息：${message.slice(0, 50)}${message.length > 50 ? "..." : ""}`;

    if (syncResult.warning) {
      resultMessage += `\n  警告：${syncResult.warning}`;
    }

    return {
      success: true,
      message: resultMessage,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      message: `错误：添加 schedule 失败：${message}`,
    };
  }
}

export async function handleScheduleRemoveCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  const args = options.args;
  if (args.length < 2) {
    return {
      success: false,
      message: `用法：/schedule remove <scheduleId> --workspace <id|path>\n` +
        `\n` +
        `参数说明:\n` +
        `  <scheduleId>  Schedule ID\n` +
        `  --workspace   Workspace ID、相对路径或绝对路径\n` +
        `\n` +
        `使用 /schedule list 查看已有的 schedules`,
    };
  }

  const scheduleId = args[0];
  const workspaceIdx = args.indexOf("--workspace");

  if (workspaceIdx === -1) {
    return {
      success: false,
      message: `用法：/schedule remove <scheduleId> --workspace <id|path>\n` +
        `\n` +
        `缺少必填参数 --workspace`,
    };
  }

  const workspaceInput = args[workspaceIdx + 1];

  if (!workspaceInput) {
    return {
      success: false,
      message: `用法：/schedule remove <scheduleId> --workspace <id|path>\n` +
        `\n` +
        `--workspace 参数值不能为空`,
    };
  }

  const entry = resolveCommandRoute(options.chatId)?.route;
  if (!entry) {
    return {
      success: false,
      message: `未绑定工作区，请先使用 /bind <dir> 绑定工作区`,
    };
  }

  try {
    const workspacePath = await resolveWorkspacePathParam(workspaceInput, options.chatId);

    // 检查 schedule 是否存在
    const { getSchedule } = await import("../config/schedules.js");
    const existing = await getSchedule(workspacePath, scheduleId);
    if (!existing) {
      return {
        success: false,
        message: `错误：Schedule 不存在 (${scheduleId})\n` +
          `\n` +
          `使用 /schedule list 查看所有 schedule`,
      };
    }

    // 删除文件
    const schedulePath = join(workspacePath, ".msgcode", "schedules", `${scheduleId}.json`);
    unlink(schedulePath);

    // 同步从 jobs.json 删除
    removeScheduleFromJobs(workspacePath, scheduleId);

    return {
      success: true,
      message: `已删除 schedule: ${scheduleId}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      message: `错误：删除 schedule 失败：${message}`,
    };
  }
}

export async function handleScheduleValidateCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  const entry = resolveCommandRoute(options.chatId)?.route;
  if (!entry) {
    return {
      success: false,
      message: `未绑定工作区，请先使用 /bind <dir> 绑定工作区`,
    };
  }

  const { validateAllSchedules } = await import("../config/schedules.js");
  const results = await validateAllSchedules(entry.workspacePath);

  if (results.length === 0) {
    return {
      success: true,
      message: `当前工作区暂无 schedules`,
    };
  }

  const valid = results.filter(r => r.valid).length;
  const lines: string[] = [`Schedule 验证结果 (${valid}/${results.length} 有效)`];

  for (const result of results) {
    if (result.valid) {
      lines.push(`✓ ${result.id}`);
    } else {
      lines.push(`✗ ${result.id} - ${result.error}`);
    }
  }

  return {
    success: true,
    message: lines.join("\n"),
  };
}

export async function handleScheduleEnableCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  const scheduleId = options.args[0];
  if (!scheduleId) {
    return {
      success: false,
      message: `用法: /schedule enable <scheduleId>\n` +
        `\n` +
        `使用 /schedule list 查看可用的 schedules`,
    };
  }

  const entry = resolveCommandRoute(options.chatId)?.route;
  if (!entry) {
    return {
      success: false,
      message: `未绑定工作区，请先使用 /bind <dir> 绑定工作区`,
    };
  }

  const { setScheduleEnabled, mapSchedulesToJobs } = await import("../config/schedules.js");
  const success = await setScheduleEnabled(entry.workspacePath, scheduleId, true);

  if (!success) {
    return {
      success: false,
      message: `Schedule "${scheduleId}" 不存在\n` +
        `\n` +
        `使用 /schedule list 查看可用的 schedules`,
    };
  }

  // P5.7-R12-T2: 自动同步 schedules 到 jobs（无需 /reload）
  await syncSchedulesToJobs(entry.workspacePath, options.chatId);

  return {
    success: true,
    message: `已启用 schedule: ${scheduleId}`,
  };
}

export async function handleScheduleDisableCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  const scheduleId = options.args[0];
  if (!scheduleId) {
    return {
      success: false,
      message: `用法: /schedule disable <scheduleId>\n` +
        `\n` +
        `使用 /schedule list 查看可用的 schedules`,
    };
  }

  const entry = resolveCommandRoute(options.chatId)?.route;
  if (!entry) {
    return {
      success: false,
      message: `未绑定工作区，请先使用 /bind <dir> 绑定工作区`,
    };
  }

  const { setScheduleEnabled, mapSchedulesToJobs } = await import("../config/schedules.js");
  const success = await setScheduleEnabled(entry.workspacePath, scheduleId, false);

  if (!success) {
    return {
      success: false,
      message: `Schedule "${scheduleId}" 不存在\n` +
        `\n` +
        `使用 /schedule list 查看可用的 schedules`,
    };
  }

  // P5.7-R12-T2: 自动同步 schedules 到 jobs（无需 /reload）
  await syncSchedulesToJobs(entry.workspacePath, options.chatId);

  return {
    success: true,
    message: `已禁用 schedule: ${scheduleId}`,
  };
}

export async function handleReloadCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  const entry = resolveCommandRoute(options.chatId)?.route;
  if (!entry) {
    return {
      success: false,
      message: `未绑定工作区，请先使用 /bind <dir> 绑定工作区`,
    };
  }

  const results: string[] = [];
  const { listSchedules, validateAllSchedules, mapSchedulesToJobs } = await import("../config/schedules.js");
  const { createJobStore } = await import("../jobs/store.js");

  const schedules = await listSchedules(entry.workspacePath);
  const scheduleValidation = await validateAllSchedules(entry.workspacePath);
  const validSchedules = scheduleValidation.filter(r => r.valid).length;
  const enabledSchedules = schedules.filter(s => s.enabled).length;
  results.push(`Schedules: ${schedules.length} 个 (${enabledSchedules} 启用, ${validSchedules} 有效)`);

  if (validSchedules < schedules.length) {
    results.push(`  ⚠️ ${schedules.length - validSchedules} 个 schedule 验证失败`);
    results.push(`  使用 /schedule validate 查看详情`);
  }

  const scheduleJobs = await mapSchedulesToJobs(entry.workspacePath, options.chatId);
  const store = createJobStore();
  const existingStore = store.loadJobs();

  if (existingStore) {
    const nonScheduleJobs = existingStore.jobs.filter(j => !j.id.startsWith("schedule:"));
    const mergedJobs = [...nonScheduleJobs, ...scheduleJobs];
    store.saveJobs({ version: 1, jobs: mergedJobs });
    results.push(`Jobs: 已更新 ${scheduleJobs.length} 个 schedule jobs (共 ${mergedJobs.length} 个 jobs)`);
  } else {
    store.saveJobs({ version: 1, jobs: scheduleJobs });
    results.push(`Jobs: 已创建 ${scheduleJobs.length} 个 schedule jobs`);
  }

  const { existsSync } = await import("node:fs");
  const skillsDir = join(process.env.HOME || "", ".config", "msgcode", "skills");
  const skillsExist = existsSync(skillsDir);
  results.push(`Skills: ${skillsExist ? "已配置" : "未配置"} (~/.config/msgcode/skills/)`);

  const { getActiveSoul, listSouls, resolveSoulContext } = await import("../config/souls.js");
  // SOUL.md 位于工作区 .msgcode 目录
  const workspaceSoulPath = join(entry.workspacePath, ".msgcode", "SOUL.md");
  const workspaceSoulExists = existsSync(workspaceSoulPath);
  const activeSoul = await getActiveSoul();
  const souls = await listSouls();

  // P5.6.8-R4e: 显示真实 SOUL 注入状态
  const soulContext = await resolveSoulContext(entry.workspacePath);
  const soulHash = soulContext.chars > 0 ? `#${soulContext.chars}c` : "none";

  results.push(`SOUL: source=${soulContext.source} path=${soulContext.path || "none"} ${soulHash}`);
  results.push(`SOUL Entries: ${souls.length} (global, active=${activeSoul?.id || "none"})`);
  results.push(`Workspace SOUL: ${workspaceSoulExists ? "yes" : "no"} (${workspaceSoulPath})`);
  results.push(`\n✓ 重新加载完成`);

  return {
    success: true,
    message: results.join("\n"),
  };
}

// ============================================
// P5.7-R12-T2: 辅助函数
// ============================================

/**
 * 同步 schedules 到 jobs（热加载）
 *
 * 用于 enable/disable 命令后自动生效，无需用户手动 /reload
 */
async function syncSchedulesToJobs(workspacePath: string, chatGuid: string): Promise<void> {
  const { mapSchedulesToJobs } = await import("../config/schedules.js");
  const { createJobStore } = await import("../jobs/store.js");

  const scheduleJobs = await mapSchedulesToJobs(workspacePath, chatGuid);
  const store = createJobStore();
  const existingStore = store.loadJobs();

  if (existingStore) {
    // 保留非 schedule jobs，合并新的 schedule jobs
    const nonScheduleJobs = existingStore.jobs.filter(j => !j.id.startsWith("schedule:"));
    const mergedJobs = [...nonScheduleJobs, ...scheduleJobs];
    store.saveJobs({ version: 1, jobs: mergedJobs });
  } else {
    store.saveJobs({ version: 1, jobs: scheduleJobs });
  }
}
