/**
 * msgcode: Schedule -> Jobs 投影与 scheduler refresh 收口
 *
 * 目标：
 * - CLI 与聊天命令共用一套 workspace 级 schedule 投影逻辑
 * - daemon 启动时按 active route 从真相源重建 schedule jobs
 * - mutation 后立刻触发 scheduler refresh
 * - 只替换当前 workspace 的 schedule jobs，不误删其他 workspace 投影
 */

import { createHash } from "node:crypto";
import { createJobStore } from "./store.js";
import { mapSchedulesToJobs } from "../config/schedules.js";
import { refreshActiveJobScheduler } from "./scheduler.js";
import { signalSingletonProcess } from "../runtime/singleton.js";
import type { CronJob } from "./types.js";
import { getActiveRoutes } from "../routes/store.js";

export type SchedulerRefreshMode = "local" | "signal" | "none";

export function getWorkspaceScheduleJobPrefix(workspacePath: string): string {
  const workspaceHash = createHash("sha256").update(workspacePath).digest("hex").slice(0, 12);
  return `schedule:${workspaceHash}:`;
}

export function getWorkspaceScheduleJobId(workspacePath: string, scheduleId: string): string {
  return `${getWorkspaceScheduleJobPrefix(workspacePath)}${scheduleId}`;
}

export async function syncWorkspaceSchedulesToJobs(
  workspacePath: string,
  chatGuid: string
): Promise<CronJob[]> {
  const scheduleJobs = await mapSchedulesToJobs(workspacePath, chatGuid);
  const store = createJobStore();
  const existingStore = store.loadJobs() ?? { version: 1 as const, jobs: [] };
  const workspacePrefix = getWorkspaceScheduleJobPrefix(workspacePath);
  const preservedJobs = existingStore.jobs.filter((job) => !job.id.startsWith(workspacePrefix));
  const mergedJobs = [...preservedJobs, ...scheduleJobs];

  store.saveJobs({ version: 1, jobs: mergedJobs });
  return scheduleJobs;
}

export async function rebuildActiveRouteScheduleJobs(): Promise<CronJob[]> {
  const store = createJobStore();
  const existingStore = store.loadJobs() ?? { version: 1 as const, jobs: [] };
  const preservedJobs = existingStore.jobs.filter((job) => !job.id.startsWith("schedule:"));
  const rebuiltById = new Map<string, CronJob>();

  for (const route of getActiveRoutes()) {
    const scheduleJobs = await mapSchedulesToJobs(route.workspacePath, route.chatGuid);
    for (const job of scheduleJobs) {
      rebuiltById.set(job.id, job);
    }
  }

  const rebuiltJobs = [...rebuiltById.values()];
  store.saveJobs({ version: 1, jobs: [...preservedJobs, ...rebuiltJobs] });
  return rebuiltJobs;
}

export async function removeWorkspaceScheduleFromJobs(
  workspacePath: string,
  scheduleId: string
): Promise<boolean> {
  const store = createJobStore();
  return store.deleteJob(getWorkspaceScheduleJobId(workspacePath, scheduleId));
}

export async function requestSchedulerRefresh(reason: string): Promise<SchedulerRefreshMode> {
  const localRefreshed = await refreshActiveJobScheduler(reason);
  if (localRefreshed) {
    return "local";
  }

  const signaled = await signalSingletonProcess("msgcode", "SIGUSR2");
  return signaled ? "signal" : "none";
}
