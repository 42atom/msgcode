/**
 * msgcode: 业务域命令（schedule/reload）
 */

import { join } from "node:path";
import { getRouteByChatId } from "./store.js";
import type { CommandHandlerOptions, CommandResult } from "./cmd-types.js";

export async function handleScheduleListCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  const entry = getRouteByChatId(options.chatId);
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

export async function handleScheduleValidateCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  const entry = getRouteByChatId(options.chatId);
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

  const entry = getRouteByChatId(options.chatId);
  if (!entry) {
    return {
      success: false,
      message: `未绑定工作区，请先使用 /bind <dir> 绑定工作区`,
    };
  }

  const { setScheduleEnabled } = await import("../config/schedules.js");
  const success = await setScheduleEnabled(entry.workspacePath, scheduleId, true);

  if (!success) {
    return {
      success: false,
      message: `Schedule "${scheduleId}" 不存在\n` +
        `\n` +
        `使用 /schedule list 查看可用的 schedules`,
    };
  }

  return {
    success: true,
    message: `已启用 schedule: ${scheduleId}\n` +
      `\n` +
      `提示: 修改后请使用 /reload 重新加载 schedules`,
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

  const entry = getRouteByChatId(options.chatId);
  if (!entry) {
    return {
      success: false,
      message: `未绑定工作区，请先使用 /bind <dir> 绑定工作区`,
    };
  }

  const { setScheduleEnabled } = await import("../config/schedules.js");
  const success = await setScheduleEnabled(entry.workspacePath, scheduleId, false);

  if (!success) {
    return {
      success: false,
      message: `Schedule "${scheduleId}" 不存在\n` +
        `\n` +
        `使用 /schedule list 查看可用的 schedules`,
    };
  }

  return {
    success: true,
    message: `已禁用 schedule: ${scheduleId}\n` +
      `\n` +
      `提示: 修改后请使用 /reload 重新加载 schedules`,
  };
}

export async function handleReloadCommand(options: CommandHandlerOptions): Promise<CommandResult> {
  const entry = getRouteByChatId(options.chatId);
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
  results.push(`SOUL Entries: ${souls.length} (active=${activeSoul?.id || "none"})`);
  results.push(`\n✓ 重新加载完成`);

  return {
    success: true,
    message: results.join("\n"),
  };
}
