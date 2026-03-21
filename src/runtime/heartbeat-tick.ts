/**
 * msgcode: Heartbeat Tick Integration - 最小可跑主链
 *
 * 职责：
 * - 驱动 "读任务 -> 选 persona -> 发 dispatch -> 子代理执行 -> 主脑回收" 完整流程
 * - 只做最小冒烟，不做完整 orchestration
 *
 * 核心流程：
 * 1. 先读 HEARTBEAT.md（草稿）
 * 2. 再读 issues/ 找 runnable tasks
 * 3. 再读 dispatch/ 找 pending/running
 * 4. 再读 subagent/ 找执行状态
 * 5. 能推进就推进，不能就 HEARTBEAT_OK
 */

import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { HeartbeatRunner, type TickContext } from "./heartbeat.js";
import { listWakeJobs, listWakeRecords } from "./wake-store.js";
import {
  loadTaskDocuments,
  loadDispatchRecords,
  loadSubagentRecords,
  parseTaskDocumentFilename,
  type TaskDocumentRecord,
  type DispatchRecord,
} from "./work-continuity.js";
import {
  runSubagentTask,
  getSubagentTaskStatus,
  sendSubagentMessage,
  type SubagentTaskRecord,
  type SubagentStatusResult,
} from "./subagent.js";
import { logger } from "../logger/index.js";
import { runBashCommand } from "../runners/bash-runner.js";
import {
  getTaskEvidencePath,
  readTaskEvidence,
  writeFailureSnapshot,
  writeTaskEvidence,
} from "./failure-evidence.js";

/**
 * Heartbeat Tick 配置
 */
export interface HeartbeatTickConfig {
  /** 工作空间路径 */
  workspacePath: string;
  /** issues 目录 */
  issuesDir?: string;
  /** 最大一次派单数 */
  maxDispatchPerTick?: number;
  /** 子代理超时 ms */
  subagentTimeoutMs?: number;
  /** 模拟子代理执行（用于测试） */
  mockSubagentFn?: (dispatch: DispatchRecord) => Promise<{ success: boolean; error?: string }>;
  /** 模拟子代理状态查询（用于测试后续 tick 监督） */
  mockSubagentStatusFn?: (dispatch: DispatchRecord) => Promise<SubagentStatusResult>;
  /** 模拟继续向运行中子代理发消息（用于测试 heartbeat follow-up） */
  mockSubagentSayFn?: (dispatch: DispatchRecord, message: string) => Promise<{ success: boolean; response?: string; error?: string }>;
  /** 在执行 subagent 前回调（用于测试验证参数） */
  beforeDispatch?: (params: {
    client: string;
    goal: string;
    persona?: string;
    taskCard?: any;
    workspace: string;
    watch: boolean;
    timeoutMs?: number;
  }) => void;
}

/**
 * Tick 执行结果
 */
export interface HeartbeatTickResult {
  /** 是否有动作 */
  hadAction: boolean;
  /** 动作摘要 */
  summary: string[];
  /** 错误 */
  errors: string[];
}

/**
 * 扫描派单记录，找 pending/running
 */
async function scanDispatchRecords(workspacePath: string): Promise<DispatchRecord[]> {
  const result = await loadDispatchRecords(workspacePath);
  return result.records.filter((d) => d.status === "pending" || d.status === "running");
}

/**
 * 扫描子代理状态，找卡住的
 */
async function scanSubagentRecords(workspacePath: string): Promise<SubagentTaskRecord[]> {
  const result = await loadSubagentRecords(workspacePath);
  return result.records;
}

function extractTaskIds(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return Array.from(new Set(value.match(/\btk\d{4}\b/gi)?.map((id) => id.toLowerCase()) ?? []));
}

function readTaskContent(taskPath: string): string {
  try {
    return readFileSync(taskPath, "utf-8");
  } catch {
    return "";
  }
}

function parseParentTaskId(task: TaskDocumentRecord): string | undefined {
  const content = readTaskContent(task.path);
  if (!content) {
    return undefined;
  }

  const parentSectionMatch = content.match(/##\s+Parent Task\s*\n([\s\S]*?)(?=\n#|\n##|$)/i);
  const parentIds = extractTaskIds(parentSectionMatch?.[1]);
  if (parentIds.length > 0) {
    return parentIds[0];
  }

  const frontMatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  const linkedIds = extractTaskIds(frontMatterMatch?.[1]).filter((id) => id !== task.id);
  if (linkedIds.length > 0) {
    return linkedIds[0];
  }

  return undefined;
}

function parseChildTaskIds(task: TaskDocumentRecord): string[] {
  const content = readTaskContent(task.path);
  const childIds = new Set<string>();

  const childSectionMatch = content.match(/##\s+Child Tasks\s*\n([\s\S]*?)(?=\n#|\n##|$)/i);
  for (const id of extractTaskIds(childSectionMatch?.[1])) {
    childIds.add(id);
  }

  for (const id of extractTaskIds(task.implicit?.waiting_for)) {
    childIds.add(id);
  }

  return Array.from(childIds);
}

/**
 * 为任务选择合适的 persona
 * 最小策略：按 board 推断
 */
function selectPersona(task: TaskDocumentRecord): string {
  const board = task.board.toLowerCase();

  // 按 board 映射 persona
  if (board.includes("frontend") || board.includes("ui") || board.includes("web")) {
    return "frontend-builder";
  }
  if (board.includes("review") || board.includes("audit")) {
    return "code-reviewer";
  }
  if (board.includes("api") || board.includes("backend")) {
    return "api-builder";
  }

  // 默认
  return "frontend-builder";
}

function extractVerificationCommands(taskContent: string): string[] | undefined {
  const sectionMatch = taskContent.match(/##\s+(?:Verify|Verification|验证命令|验证)\s*\n([\s\S]*?)(?=\n#{1,2}\s|$)/);
  if (!sectionMatch?.[1]) {
    return undefined;
  }

  const commands: string[] = [];
  const lines = sectionMatch[1].split("\n");
  let inShellFence = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("```")) {
      inShellFence = !inShellFence;
      continue;
    }

    if (inShellFence) {
      commands.push(line);
      continue;
    }

    const bulletMatch = line.match(/^[-*]\s+`?(.+?)`?$/);
    if (bulletMatch?.[1]) {
      commands.push(bulletMatch[1].trim());
      continue;
    }

    const numberedMatch = line.match(/^\d+\.\s+`?(.+?)`?$/);
    if (numberedMatch?.[1]) {
      commands.push(numberedMatch[1].trim());
    }
  }

  return commands.length > 0 ? commands : undefined;
}

function extractSupervisorMessage(taskContent: string): string | undefined {
  const sectionMatch = taskContent.match(/##\s+(?:Follow-up|Supervisor Message|继续说明|补充说明)\s*\n([\s\S]*?)(?=\n#{1,2}\s|$)/);
  if (!sectionMatch?.[1]) {
    return undefined;
  }
  const message = sectionMatch[1].trim();
  return message.length > 0 ? message : undefined;
}

function hashSupervisorMessage(message: string): string {
  return createHash("sha1").update(message.trim()).digest("hex");
}

function getStatusSnapshotPath(workspacePath: string): string {
  return path.join(workspacePath, ".msgcode", "STATUS");
}

function formatRelativeMs(isoTime: string | undefined): string {
  if (!isoTime) {
    return "-";
  }
  const diffMs = Math.max(0, Date.now() - Date.parse(isoTime));
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) {
    return "just-now";
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  return `${Math.floor(hours / 24)}d ago`;
}

function summarizeWakeSchedule(job: { kind: string; schedule: { kind: string } }): string {
  if (job.schedule.kind === "at") {
    return "at";
  }
  if (job.schedule.kind === "every") {
    return "every";
  }
  if (job.schedule.kind === "cron") {
    return "cron";
  }
  return job.kind;
}

async function writeStatusSnapshot(
  workspacePath: string,
  heartbeatResult: HeartbeatTickResult
): Promise<void> {
  const dispatchResult = await loadDispatchRecords(workspacePath);
  const subagentResult = await loadSubagentRecords(workspacePath);
  const wakeRecords = listWakeRecords(workspacePath);
  const wakeJobs = listWakeJobs(workspacePath);
  const lines: string[] = [`# msgcode status @ ${new Date().toISOString()}`, ""];

  lines.push("## dispatch");
  if (dispatchResult.records.length === 0) {
    lines.push("(none)");
  } else {
    for (const record of dispatchResult.records) {
      lines.push(`${record.dispatchId}  ${record.status.padEnd(9)}  ${record.childTaskId}  ${record.goal}`);
    }
  }
  lines.push("");

  lines.push("## wakes");
  if (wakeRecords.length > 0) {
    for (const record of wakeRecords) {
      lines.push(`${record.id}  ${record.status.padEnd(9)}  ${record.path}  ${record.taskId ?? record.hint ?? "-"}`);
    }
  } else if (wakeJobs.length > 0) {
    for (const job of wakeJobs.filter((item) => item.enabled)) {
      lines.push(`${job.id}  enabled    ${summarizeWakeSchedule(job)}  ${job.taskId ?? job.hint ?? "-"}`);
    }
  } else {
    lines.push("(none)");
  }
  lines.push("");

  lines.push("## subagents");
  if (subagentResult.records.length === 0) {
    lines.push("(none)");
  } else {
    for (const record of subagentResult.records) {
      lines.push(`${record.client}  ${record.status.padEnd(9)}  ${record.taskId}  since ${formatRelativeMs(record.createdAt)}`);
    }
  }
  lines.push("");

  lines.push("## heartbeat");
  if (heartbeatResult.summary.length === 0 && heartbeatResult.errors.length === 0) {
    lines.push("HEARTBEAT_OK");
  } else {
    for (const item of heartbeatResult.summary) {
      lines.push(`- ${item}`);
    }
    for (const item of heartbeatResult.errors) {
      lines.push(`! ${item}`);
    }
  }
  lines.push("");

  const statusPath = getStatusSnapshotPath(workspacePath);
  mkdirSync(path.dirname(statusPath), { recursive: true });
  writeFileSync(statusPath, `${lines.join("\n")}\n`);
}

async function runTaskVerification(task: TaskDocumentRecord, workspacePath: string): Promise<{
  ok: boolean;
  exitCode: number;
  cachedFailure?: boolean;
  evidencePath?: string;
}> {
  const commands = task.verificationCommands ?? [];
  if (commands.length === 0) {
    return { ok: true, exitCode: 0 };
  }

  const existingEvidence = readTaskEvidence(workspacePath, task.id);
  if (existingEvidence && existingEvidence.exitCode !== 0) {
    return {
      ok: false,
      exitCode: existingEvidence.exitCode,
      cachedFailure: true,
      evidencePath: getTaskEvidencePath(workspacePath, task.id),
    };
  }

  const commandEnv: NodeJS.ProcessEnv = { ...process.env, NODE_OPTIONS: "" };
  const commandResults: Array<{
    command: string;
    exitCode: number;
    ok: boolean;
    stdoutTail: string;
    stderrTail: string;
    durationMs: number;
    fullOutputPath?: string;
    error?: string;
  }> = [];

  for (const command of commands) {
    const result = await runBashCommand({
      command,
      cwd: workspacePath,
      env: commandEnv,
      timeoutMs: 120000,
    });
    commandResults.push({
      command,
      exitCode: result.exitCode,
      ok: result.ok,
      stdoutTail: result.stdoutTail,
      stderrTail: result.stderrTail,
      durationMs: result.durationMs,
      fullOutputPath: result.fullOutputPath,
      error: result.error,
    });
    if (!result.ok) {
      break;
    }
  }

  const failing = commandResults.find((item) => !item.ok);
  const evidence = {
    taskId: task.id,
    ok: !failing,
    exitCode: failing?.exitCode ?? 0,
    timestamp: new Date().toISOString(),
    commands: commandResults,
  };
  const evidencePath = await writeTaskEvidence(workspacePath, task.id, evidence);
  if (failing) {
    await writeFailureSnapshot(workspacePath, {
      kind: "verify",
      taskId: task.id,
      timestamp: evidence.timestamp,
      exitCode: failing.exitCode,
      command: failing.command,
      durationMs: failing.durationMs,
      stdoutTail: failing.stdoutTail,
      stderrTail: failing.stderrTail,
      error: failing.error,
      artifactRefs: failing.fullOutputPath ? [failing.fullOutputPath] : [],
    });
  }
  return {
    ok: evidence.ok,
    exitCode: evidence.exitCode,
    cachedFailure: false,
    evidencePath,
  };
}

/**
 * 创建派单记录
 */
function createDispatchRecord(workspacePath: string, task: TaskDocumentRecord, persona: string): DispatchRecord {
  const dispatchId = `dispatch-${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  const parentTaskId = parseParentTaskId(task) ?? task.id;

  // P1修复: 从任务文档内容提取 goal，而不是简单从 slug 还原
  let goal = task.slug.replace(/-/g, " "); // 默认从 slug 还原
  let acceptance: string[] = task.accept ? [task.accept] : ["任务完成"];
  let verificationCommands: string[] | undefined;
  let expectedArtifacts: string[] | undefined;

  // 尝试读取任务文档内容
  try {
    const taskContent = readFileSync(task.path, "utf-8");
    const lines = taskContent.split("\n");

    // 提取 Task 部分作为 goal（支持多种格式）
    const taskMatch = taskContent.match(/^#\s+Task\s*\n([\s\S]*?)(?=\n#|\n##|$)/m);
    if (taskMatch && taskMatch[1]) {
      const taskLines = taskMatch[1].trim().split("\n");
      // 找第一行非空内容
      for (const line of taskLines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("<!--")) {
          goal = trimmed;
          break;
        }
      }
    } else {
      // 如果没有明确的 Task 部分，尝试找第一个非空段落
      for (const line of lines) {
        const trimmed = line.trim();
        // 跳过 front matter、标题、空行
        if (trimmed && !trimmed.startsWith("---") && !trimmed.startsWith("#") && !trimmed.startsWith("<!--")) {
          goal = trimmed;
          break;
        }
      }
    }

    // 提取验收标准
    const acceptMatch = taskContent.match(/##\s+验收标准[^]*?\n([\s\S]*?)(?=\n#|\n##|$)/m);
    if (acceptMatch && acceptMatch[1]) {
      const acceptLines = acceptMatch[1]
        .split("\n")
        .map(line => line.trim())
        .filter(line => line.match(/^\d+\.\s*\*\*.+\*\*:/))
        .map(line => line.replace(/^\d+\.\s*\*\*[^*]+\*\*:\s*/, "").trim());
      if (acceptLines.length > 0) {
        acceptance = acceptLines;
      }
    }

    verificationCommands = extractVerificationCommands(taskContent);

    // 提取产物路径
    const artifactMatch = taskContent.match(/##\s+产物路径\s*\n\s*`?([^`\n]+)`?\s*\n/m);
    if (artifactMatch && artifactMatch[1]) {
      expectedArtifacts = [artifactMatch[1].trim()];
    }
  } catch (error) {
    logger.warn("[HeartbeatTick] 无法读取任务文档内容，使用默认值", {
      taskId: task.id,
      error: error instanceof Error ? error.message : String(error)
    });
  }

  const record: DispatchRecord = {
    dispatchId,
    parentTaskId,
    childTaskId: task.id,
    client: task.assignee || "codex",
    persona,
    goal,
    cwd: workspacePath,
    acceptance,
    verificationCommands,
    expectedArtifacts,
    status: "pending",
    createdAt: now,
    updatedAt: now,
    filePath: path.join(workspacePath, ".msgcode", "dispatch", `${dispatchId}.json`),
  };

  // 写文件
  const dispatchDir = path.join(workspacePath, ".msgcode", "dispatch");
  mkdirSync(dispatchDir, { recursive: true });
  writeFileSync(record.filePath!, JSON.stringify(record, null, 2));

  return record;
}

/**
 * 推进任务文档状态（tdo -> doi -> rvw -> pss -> dne）
 */
function advanceTaskState(
  workspacePath: string,
  taskId: string,
  newState: "doi" | "rvw" | "bkd" | "pss" | "dne"
): boolean {
  const issuesDir = path.join(workspacePath, "issues");

  if (!existsSync(issuesDir)) {
    return false;
  }

  try {
    // 找当前状态
    const entries = readdirSync(issuesDir);
    const currentFile = entries.find((e: string) =>
      e.startsWith(`${taskId}.`) && e.endsWith(".md")
    );

    if (!currentFile) {
      logger.warn("[HeartbeatTick] 任务文件不存在", { taskId });
      return false;
    }

    // 解析当前状态
    const parts = currentFile.replace(".md", "").split(".");
    if (parts.length < 2) {
      return false;
    }

    const currentState = parts[1];
    // 跳过：如果目标状态等于当前状态
    if (currentState === newState) {
      logger.debug("[HeartbeatTick] 任务状态已是目标状态", { taskId, state: newState });
      return true;
    }

    const newFileName = `${taskId}.${newState}.${parts.slice(2).join(".")}.md`;
    const oldPath = path.join(issuesDir, currentFile);
    const newPath = path.join(issuesDir, newFileName);

    // P1修复: 优先尝试 git mv，非 git workspace 时 fallback 到普通 mv
    try {
      execSync(`git mv "${oldPath}" "${newPath}"`, {
        cwd: workspacePath,
        stdio: "ignore",
      });
    } catch {
      // 非 git workspace，使用普通文件重命名
      try {
        renameSync(oldPath, newPath);
        logger.info("[HeartbeatTick] 任务状态已推进(非git)", {
          taskId,
          from: currentState,
          to: newState,
        });
      } catch (renameError) {
        logger.warn("[HeartbeatTick] 任务状态推进失败", {
          taskId,
          error: renameError instanceof Error ? renameError.message : String(renameError),
        });
        return false;
      }
    }

    logger.info("[HeartbeatTick] 任务状态已推进", {
      taskId,
      from: currentState,
      to: newState,
    });

    return true;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.warn("[HeartbeatTick] 推进任务状态失败", { taskId, error: errorMsg });
    return false;
  }
}

function advanceParentTaskIfReady(workspacePath: string, parentTaskId: string, childTaskId: string): boolean {
  if (!parentTaskId || parentTaskId === childTaskId) {
    return false;
  }

  const issuesDir = path.join(workspacePath, "issues");
  if (!existsSync(issuesDir)) {
    return false;
  }

  try {
    const entries = readdirSync(issuesDir);
    const taskDocs = entries
      .filter((entry: string) => entry.endsWith(".md"))
      .map((entry: string) => parseTaskDocumentFilename(path.join(issuesDir, entry)))
      .filter((record: TaskDocumentRecord | null): record is TaskDocumentRecord => Boolean(record));

    const parentTask = taskDocs.find((task: TaskDocumentRecord) => task.id === parentTaskId);
    if (!parentTask) {
      return false;
    }

    const childTaskIds = parseChildTaskIds(parentTask);
    if (childTaskIds.length === 0) {
      return false;
    }

    const allChildrenPassed = childTaskIds.every((taskId) => {
      const childTask = taskDocs.find((task: TaskDocumentRecord) => task.id === taskId);
      return childTask && (childTask.state === "pss" || childTask.state === "dne");
    });

    if (!allChildrenPassed) {
      return false;
    }

    if (parentTask.state === "tdo" || parentTask.state === "doi") {
      return advanceTaskState(workspacePath, parentTaskId, "rvw");
    }

    return false;
  } catch (error) {
    logger.warn("[HeartbeatTick] 推进父任务失败", {
      parentTaskId,
      childTaskId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * 执行派单
 */
async function executeDispatch(
  dispatch: DispatchRecord,
  config: HeartbeatTickConfig
): Promise<{ success: boolean; error?: string; timeout?: boolean }> {
  // 如果提供了 mock 函数（测试用），处理 mock 结果和超时场景
  if (config.mockSubagentFn) {
    // P2修复: 即使 mock 也要调用 beforeDispatch 以便测试验证参数
    const mockParams = {
      client: dispatch.client,
      goal: dispatch.goal,
      persona: dispatch.persona,
      taskCard: {
        cwd: dispatch.cwd,
        constraints: dispatch.constraints,
        acceptance: dispatch.acceptance,
        verification: dispatch.verificationCommands,
        artifacts: dispatch.expectedArtifacts,
        parentTask: dispatch.childTaskId,
      },
      workspace: config.workspacePath,
      watch: true,
      timeoutMs: config.subagentTimeoutMs || 5 * 60 * 1000,
    };
    if (config.beforeDispatch) {
      config.beforeDispatch(mockParams);
    }

    try {
      const mockResult = await config.mockSubagentFn(dispatch) as {
        success: boolean;
        error?: string;
        task?: { taskId?: string };
        watchResult?: { success?: boolean; response?: string };
      };

      if (mockResult.success) {
        dispatch.status = "completed";
        if (mockResult.task?.taskId) {
          dispatch.subagentTaskId = mockResult.task.taskId;
        }
        dispatch.result = {
          completed: mockResult.watchResult?.success ?? true,
          summary: mockResult.watchResult?.response?.slice(0, 500) || "",
        };
        dispatch.updatedAt = new Date().toISOString();
        writeFileSync(dispatch.filePath!, JSON.stringify(dispatch, null, 2));

        if (dispatch.result.completed) {
          advanceTaskState(config.workspacePath, dispatch.childTaskId, "rvw");
        }
      }

      return mockResult;
    } catch (error) {
      // P1修复: mock 超时也要走完整的超时处理逻辑
      const errorMsg = error instanceof Error ? error.message : String(error);
      const isWatchTimeout =
        errorMsg.includes("SUBAGENT_WATCH_TIMEOUT") ||
        errorMsg.includes("watch timeout") ||
        errorMsg.includes("watch 超时") ||
        errorMsg.includes("超时");

      if (isWatchTimeout) {
        logger.warn("[HeartbeatTick] Mock 子代理执行超时，保持running状态", {
          dispatchId: dispatch.dispatchId,
        });

        dispatch.status = "running";
        dispatch.result = {
          completed: false,
          summary: `Mock执行超时: ${errorMsg.slice(0, 200)}`,
        };
        dispatch.updatedAt = new Date().toISOString();

        // 尝试从错误消息提取 taskId
        const taskIdMatch = errorMsg.match(/任务仍在运行:\s*([a-f0-9-]+)/);
        if (taskIdMatch) {
          dispatch.subagentTaskId = taskIdMatch[1];
          logger.info("[HeartbeatTick] Mock超时回填 subagentTaskId", {
            dispatchId: dispatch.dispatchId,
            subagentTaskId: dispatch.subagentTaskId,
          });
        }

        writeFileSync(dispatch.filePath!, JSON.stringify(dispatch, null, 2));
        return { success: false, error: errorMsg, timeout: true };
      }

      // 非 mockSubagentFn 抛错时，直接返回错误
      dispatch.status = "failed";
      dispatch.result = {
        completed: false,
        summary: errorMsg,
      };
      dispatch.updatedAt = new Date().toISOString();
      writeFileSync(dispatch.filePath!, JSON.stringify(dispatch, null, 2));

      return { success: false, error: errorMsg };
    }
  }

  try {
    logger.info("[HeartbeatTick] 执行派单", {
      dispatchId: dispatch.dispatchId,
      client: dispatch.client,
      goal: dispatch.goal,
    });

    const subagentParams = {
      client: dispatch.client,
      goal: dispatch.goal,
      persona: dispatch.persona,
      taskCard: {
        cwd: dispatch.cwd,
        constraints: dispatch.constraints,
        acceptance: dispatch.acceptance,
        verification: dispatch.verificationCommands,
        artifacts: dispatch.expectedArtifacts,
        parentTask: dispatch.childTaskId,
      },
      workspace: config.workspacePath,
      watch: true,
      timeoutMs: config.subagentTimeoutMs || 5 * 60 * 1000,
    };

    // P2修复: 调用回调以便测试验证参数
    if (config.beforeDispatch) {
      config.beforeDispatch(subagentParams);
    }

    const result = await runSubagentTask(subagentParams);

    // 更新派单状态
    dispatch.status = "completed";
    dispatch.subagentTaskId = result.task.taskId;
    dispatch.result = {
      completed: result.watchResult?.success || false,
      summary: result.watchResult?.response?.slice(0, 500) || "",
    };
    dispatch.updatedAt = new Date().toISOString();
    writeFileSync(dispatch.filePath!, JSON.stringify(dispatch, null, 2));

    // 推进子任务文档状态（tdo -> pss 表示完成待验收）
    if (result.watchResult?.success) {
      advanceTaskState(config.workspacePath, dispatch.childTaskId, "rvw");
    }

    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    // P1修复: 匹配中文和英文超时关键词
    const isWatchTimeout =
      errorMsg.includes("SUBAGENT_WATCH_TIMEOUT") ||
      errorMsg.includes("watch timeout") ||
      errorMsg.includes("watch 超时") ||
      errorMsg.includes("超时");

    // P1修复: watch超时不应标记为failed，子代理仍在running
    if (isWatchTimeout) {
      logger.warn("[HeartbeatTick] 子代理执行超时，保持running状态", {
        dispatchId: dispatch.dispatchId,
        subagentTaskId: dispatch.subagentTaskId,
      });

      // P1修复: 保持 running 状态和 确保 subagentTaskId 存在
      dispatch.status = "running";
      dispatch.result = {
        completed: false,
        summary: `执行超时，子代理仍在运行: ${errorMsg.slice(0, 200)}`,
      };
      dispatch.updatedAt = new Date().toISOString();

      // P1修复: 从错误消息中提取 taskId 并回填，或从 .msgcode/subagents/ 反查
      if (!dispatch.subagentTaskId) {
        // 尝试从错误消息提取 taskId
        const taskIdMatch = errorMsg.match(/任务仍在运行:\s*([a-f0-9-]+)/);
        if (taskIdMatch) {
          dispatch.subagentTaskId = taskIdMatch[1];
          logger.info("[HeartbeatTick] 从超时消息回填 subagentTaskId", {
            dispatchId: dispatch.dispatchId,
            subagentTaskId: dispatch.subagentTaskId,
          });
        } else {
          // 从 .msgcode/subagents/*.json 反查最新任务
          try {
            const subagentDir = path.join(config.workspacePath, ".msgcode", "subagents");
            if (existsSync(subagentDir)) {
              const entries = readdirSync(subagentDir);
              const jsonFiles = entries.filter((e: string) => e.endsWith(".json"));
              if (jsonFiles.length > 0) {
                // 按修改时间排序，取最新
                const sortedFiles = jsonFiles
                  .map((f: string) => ({
                    file: f,
                    mtime: statSync(path.join(subagentDir, f)).mtime.getTime(),
                  }))
                  .sort((a: any, b: any) => b.mtime - a.mtime);

                if (sortedFiles.length > 0) {
                  const latestFile = sortedFiles[0].file;
                  const taskId = latestFile.replace(".json", "");
                  dispatch.subagentTaskId = taskId;
                  logger.info("[HeartbeatTick] 从 subagents 目录反查回填 subagentTaskId", {
                    dispatchId: dispatch.dispatchId,
                    subagentTaskId: dispatch.subagentTaskId,
                    source: latestFile,
                  });
                }
              }
            }
          } catch (recoveryError) {
            logger.warn("[HeartbeatTick] 反查 subagentTaskId 失败", {
              dispatchId: dispatch.dispatchId,
              error: recoveryError instanceof Error ? recoveryError.message : String(recoveryError),
            });
          }
        }

        // 最终检查
        if (!dispatch.subagentTaskId) {
          logger.warn("[HeartbeatTick] 超时但无法获取 subagentTaskId，后续监督可能失败", {
            dispatchId: dispatch.dispatchId,
          });
        }
      }
      writeFileSync(dispatch.filePath!, JSON.stringify(dispatch, null, 2));

      // 不返回 failure，让后续 tick 继续巡检
      return { success: false, error: errorMsg, timeout: true };
    }

    logger.error("[HeartbeatTick] 派单失败", { dispatchId: dispatch.dispatchId, error: errorMsg });

    // 更新派单状态为失败
    dispatch.status = "failed";
    dispatch.result = {
      completed: false,
      summary: errorMsg,
    };
    dispatch.updatedAt = new Date().toISOString();
    writeFileSync(dispatch.filePath!, JSON.stringify(dispatch, null, 2));

    return { success: false, error: errorMsg };
  }
}

/**
 * 检查子代理是否完成
 */
async function checkSubagentCompletion(
  dispatch: DispatchRecord,
  workspacePath: string,
  config?: HeartbeatTickConfig
): Promise<"running" | "completed" | "failed"> {
  if (!dispatch.subagentTaskId) {
    return "running";
  }

  try {
    const status = config?.mockSubagentStatusFn
      ? await config.mockSubagentStatusFn(dispatch)
      : await getSubagentTaskStatus({
          taskId: dispatch.subagentTaskId,
          workspace: workspacePath,
        });

    if (status.task.status === "completed") {
      // 更新 dispatch result
      dispatch.result = {
        completed: true,
        summary: status.paneTail.slice(0, 500),
      };
      dispatch.status = "completed";
      dispatch.updatedAt = new Date().toISOString();
      if (dispatch.filePath) {
        writeFileSync(dispatch.filePath, JSON.stringify(dispatch, null, 2));
      }
      advanceTaskState(workspacePath, dispatch.childTaskId, "rvw");
      return "completed";
    }

    if (status.task.status === "failed") {
      dispatch.result = {
        completed: false,
        summary: status.paneTail.slice(0, 500),
      };
      dispatch.status = "failed";
      dispatch.updatedAt = new Date().toISOString();
      if (dispatch.filePath) {
        writeFileSync(dispatch.filePath, JSON.stringify(dispatch, null, 2));
      }
      return "failed";
    }

    return "running";
  } catch {
    return "running";
  }
}

async function continueRunningDispatchIfNeeded(
  dispatch: DispatchRecord,
  taskDocs: TaskDocumentRecord[],
  workspacePath: string,
  config?: HeartbeatTickConfig
): Promise<boolean> {
  if (dispatch.status !== "running" || !dispatch.subagentTaskId || !dispatch.filePath) {
    return false;
  }

  const childTask = taskDocs.find((task) => task.id === dispatch.childTaskId);
  if (!childTask) {
    return false;
  }

  const supervisorMessage = extractSupervisorMessage(readTaskContent(childTask.path));
  if (!supervisorMessage) {
    return false;
  }

  const messageHash = hashSupervisorMessage(supervisorMessage);
  if (dispatch.lastSupervisorMessageHash === messageHash) {
    return false;
  }

  const sayResult = config?.mockSubagentSayFn
    ? await config.mockSubagentSayFn(dispatch, supervisorMessage)
    : await sendSubagentMessage({
        taskId: dispatch.subagentTaskId,
        message: supervisorMessage,
        workspace: workspacePath,
        watch: false,
      }).then((result) => ({
        success: true,
        response: result.response,
        error: undefined,
      })).catch((error: unknown) => ({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }));

  if (!sayResult.success) {
    logger.warn("[HeartbeatTick] 继续向子代理发消息失败", {
      dispatchId: dispatch.dispatchId,
      childTaskId: dispatch.childTaskId,
      error: sayResult.error,
    });
    return false;
  }

  dispatch.lastSupervisorMessageHash = messageHash;
  dispatch.lastSupervisorMessageAt = new Date().toISOString();
  dispatch.updatedAt = dispatch.lastSupervisorMessageAt;
  writeFileSync(dispatch.filePath, JSON.stringify(dispatch, null, 2));
  logger.info("[HeartbeatTick] 已向运行中的子代理发送 follow-up", {
    dispatchId: dispatch.dispatchId,
    childTaskId: dispatch.childTaskId,
  });
  return true;
}

/**
 * 创建 heartbeat tick 处理器
 */
export function createHeartbeatTickHandler(config: HeartbeatTickConfig) {
  const issuesDir = config.issuesDir || path.join(config.workspacePath, "issues");

  return async (ctx: TickContext): Promise<void> => {
    const result: HeartbeatTickResult = {
      hadAction: false,
      summary: [],
      errors: [],
    };

    try {
      logger.info("[HeartbeatTick] 开始巡检", {
        tickId: ctx.tickId,
        workspace: config.workspacePath,
      });

      const taskDocs = await loadTaskDocuments(issuesDir);

      // 1. 扫描 dispatch 记录 - 优先检查 pending/running
      const dispatchRecords = await scanDispatchRecords(config.workspacePath);

      // 2. 对于 running 的 dispatch，检查子代理状态
      for (const dispatch of dispatchRecords) {
        if (dispatch.status === "running" && dispatch.subagentTaskId) {
          const completion = await checkSubagentCompletion(dispatch, config.workspacePath, config);
          if (completion === "completed" || completion === "failed") {
            result.hadAction = true;
            result.summary.push(`子代理 ${dispatch.subagentTaskId} 已${completion}`);
          } else {
            const continued = await continueRunningDispatchIfNeeded(dispatch, taskDocs, config.workspacePath, config);
            if (continued) {
              result.hadAction = true;
              result.summary.push(`已继续追问运行中的子代理 ${dispatch.subagentTaskId}`);
            }
          }
        }
      }

      const currentDispatchRecords = await scanDispatchRecords(config.workspacePath);
      const currentTaskDocs = await loadTaskDocuments(issuesDir);

      // 3. 如果没有 active dispatch，找可执行的子任务
      const activeDispatches = currentDispatchRecords.filter((d) => d.status === "pending" || d.status === "running");
      if (activeDispatches.length === 0) {
        const taskById = new Map(currentTaskDocs.map((task) => [task.id, task]));
        const runnableTasks = currentTaskDocs.filter((t) => {
          if (!(t.assignee && t.assignee !== "user" && t.assignee !== "agent")) {
            return false;
          }
          if (!(t.state === "tdo" || t.state === "doi")) {
            return false;
          }
          const dependencies = extractTaskIds(t.implicit?.waiting_for);
          if (dependencies.length === 0) {
            return true;
          }
          return dependencies.every((taskId) => {
            const dependency = taskById.get(taskId);
            return dependency && (dependency.state === "pss" || dependency.state === "dne");
          });
        });
        if (runnableTasks.length > 0) {
          // 取第一个可执行任务
          const task = runnableTasks[0];
          const persona = selectPersona(task);

          // 创建派单
          const dispatch = createDispatchRecord(config.workspacePath, task, persona);
          result.summary.push(`创建派单 ${dispatch.dispatchId} for task ${task.id}`);

          // 执行派单（只派一个，避免 tick 内堆叠）
          const execResult = await executeDispatch(dispatch, config);
          if (execResult.success) {
            result.summary.push(`派单 ${dispatch.dispatchId} 执行完成`);
          } else {
            result.errors.push(`派单 ${dispatch.dispatchId} 失败: ${execResult.error}`);
          }
          result.hadAction = true;
        }
      } else {
        result.summary.push(`${activeDispatches.length} 个 active dispatch 待处理`);
      }

      // 4. 扫描 rvw 子任务，按 Verify 合同推进到 pss
      const reviewTaskDocs = await loadTaskDocuments(issuesDir);
      const reviewableTasks = reviewTaskDocs.filter((task) => {
        if (!task.assignee || task.assignee === "user" || task.assignee === "agent") {
          return false;
        }
        return task.state === "rvw";
      });
      if (reviewableTasks.length > 0) {
        const allDispatchResult = await loadDispatchRecords(config.workspacePath);
        for (const task of reviewableTasks) {
          const verifyResult = await runTaskVerification(task, config.workspacePath);
          if (!verifyResult.ok) {
            if (verifyResult.evidencePath) {
              result.summary.push(`任务 ${task.id} 验证未过，证据已写入 ${verifyResult.evidencePath}`);
              result.hadAction = true;
            }
            if (verifyResult.cachedFailure) {
              const blocked = advanceTaskState(config.workspacePath, task.id, "bkd");
              if (blocked) {
                result.summary.push(`任务 ${task.id} 验证连续失败，已推进到 bkd`);
                result.hadAction = true;
              }
            }
            continue;
          }

          const advanced = advanceTaskState(config.workspacePath, task.id, "pss");
          if (!advanced) {
            continue;
          }

          const latestDispatch = allDispatchResult.records
            .filter((record) => record.childTaskId === task.id)
            .sort((lhs, rhs) => Date.parse(rhs.updatedAt || rhs.createdAt) - Date.parse(lhs.updatedAt || lhs.createdAt))[0];
          if (latestDispatch) {
            advanceParentTaskIfReady(config.workspacePath, latestDispatch.parentTaskId, latestDispatch.childTaskId);
          }
          result.summary.push(`任务 ${task.id} 已通过验证并推进到 pss`);
          result.hadAction = true;
        }
      }

      // 5. 输出结果
      if (!result.hadAction) {
        logger.info("[HeartbeatTick] HEARTBEAT_OK - 无待处理任务");
      } else {
        logger.info("[HeartbeatTick] 动作完成", { summary: result.summary });
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error("[HeartbeatTick] 巡检失败", { error: errorMsg });
      result.errors.push(errorMsg);
    }

    try {
      await writeStatusSnapshot(config.workspacePath, result);
    } catch (error) {
      logger.warn("[HeartbeatTick] 写 STATUS 快照失败", {
        workspace: config.workspacePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}

/**
 * 启动 heartbeat tick 循环
 */
export function startHeartbeatTick(
  config: HeartbeatTickConfig,
  intervalMs?: number
): HeartbeatRunner {
  const runner = new HeartbeatRunner({
    intervalMs: intervalMs || 60_000, // 默认 1 分钟
    tag: "heartbeat-tick",
  });

  const tickHandler = createHeartbeatTickHandler(config);
  runner.onTick(tickHandler);
  runner.start();

  logger.info("[HeartbeatTick] 已启动", {
    workspace: config.workspacePath,
    intervalMs: intervalMs || 60_000,
  });

  return runner;
}
