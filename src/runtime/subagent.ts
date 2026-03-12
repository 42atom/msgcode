/**
 * msgcode: subagent runtime（MVP）
 *
 * 设计目标：
 * - 只提供最小正式合同：run / status / stop
 * - 直接复用现有 tmux 执行臂，不新增控制面
 * - 任务状态只落盘到 workspace/.msgcode/subagents/*.json
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { getWorkspacePath } from "../cli/command-runner.js";
import { logger } from "../logger/index.js";
import { handleTmuxSend } from "../tmux/responder.js";
import { sendEscape, sendMessage } from "../tmux/sender.js";
import { TmuxSession } from "../tmux/session.js";

export type SubagentClient = "codex" | "claude-code";
export type SubagentTaskStatus = "running" | "completed" | "failed" | "stopped";

export const SUBAGENT_ERROR_CODES = {
  INVALID_CLIENT: "SUBAGENT_INVALID_CLIENT",
  TASK_NOT_FOUND: "SUBAGENT_TASK_NOT_FOUND",
  BUSY: "SUBAGENT_BUSY",
  START_FAILED: "SUBAGENT_START_FAILED",
  DELEGATE_FAILED: "SUBAGENT_DELEGATE_FAILED",
  STOP_FAILED: "SUBAGENT_STOP_FAILED",
  WATCH_TIMEOUT: "SUBAGENT_WATCH_TIMEOUT",
  TASK_FAILED: "SUBAGENT_TASK_FAILED",
} as const;

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const WATCH_POLL_INTERVAL_MS = 1500;

export interface SubagentTaskRecord {
  taskId: string;
  client: SubagentClient;
  workspacePath: string;
  groupName: string;
  sessionName: string;
  goal: string;
  status: SubagentTaskStatus;
  doneMarker: string;
  failedMarker: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  stoppedAt?: string;
  watchMode: boolean;
  resultText?: string;
  lastPaneTail?: string;
  taskFile: string;
}

export interface RunSubagentInput {
  client: string;
  goal: string;
  workspace?: string;
  watch?: boolean;
  timeoutMs?: number;
}

export class SubagentRuntimeError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export interface RunSubagentResult {
  task: SubagentTaskRecord;
  startupMessage: string;
  watchResult?: {
    success: boolean;
    response?: string;
    error?: string;
    timedOut?: boolean;
  };
}

export interface SubagentStatusResult {
  task: SubagentTaskRecord;
  paneTail: string;
}

function assertClient(client: string): SubagentClient {
  if (client === "codex" || client === "claude-code") {
    return client;
  }
  throw new SubagentRuntimeError(
    SUBAGENT_ERROR_CODES.INVALID_CLIENT,
    `不支持的子代理执行臂: ${client}（仅支持 codex | claude-code）`,
  );
}

function resolveWorkspacePath(workspace?: string): string {
  if (workspace && String(workspace).trim()) {
    return getWorkspacePath(workspace);
  }
  return path.resolve(process.cwd());
}

function getSubagentDir(workspacePath: string): string {
  return path.join(workspacePath, ".msgcode", "subagents");
}

function getTaskFilePath(workspacePath: string, taskId: string): string {
  return path.join(getSubagentDir(workspacePath), `${taskId}.json`);
}

function buildGroupName(client: SubagentClient, workspacePath: string): string {
  const base = path.basename(workspacePath).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "workspace";
  const digest = createHash("sha1").update(workspacePath).digest("hex").slice(0, 6);
  return `subagent-${client}-${base}-${digest}`;
}

function buildDoneMarker(taskId: string): string {
  return `MSGCODE_SUBAGENT_DONE ${taskId}`;
}

function buildFailedMarker(taskId: string): string {
  return `MSGCODE_SUBAGENT_FAILED ${taskId}`;
}

function buildDelegationPrompt(record: SubagentTaskRecord): string {
  return [
    "你现在是 msgcode 的子代理执行臂。",
    "请只执行任务，不要反问，不要汇报长过程。",
    "",
    `task_id: ${record.taskId}`,
    `workspace: ${record.workspacePath}`,
    "",
    "goal:",
    record.goal.trim(),
    "",
    "完成协议：",
    `- 成功完成后，最后单独输出一行：${record.doneMarker}`,
    `- 若确定无法完成，最后单独输出一行：${record.failedMarker}`,
    "- 除了上面的标记行，不要改写标记文本。",
  ].join("\n");
}

async function ensureSubagentDir(workspacePath: string): Promise<void> {
  await mkdir(getSubagentDir(workspacePath), { recursive: true });
}

async function writeTaskRecord(record: SubagentTaskRecord): Promise<void> {
  await ensureSubagentDir(record.workspacePath);
  await writeFile(record.taskFile, JSON.stringify(record, null, 2), "utf8");
}

async function readTaskRecord(taskFile: string): Promise<SubagentTaskRecord> {
  const content = await readFile(taskFile, "utf8");
  return JSON.parse(content) as SubagentTaskRecord;
}

async function findTaskFile(workspacePath: string, taskId: string): Promise<string> {
  const taskFile = getTaskFilePath(workspacePath, taskId);
  try {
    await stat(taskFile);
    return taskFile;
  } catch {
    throw new SubagentRuntimeError(
      SUBAGENT_ERROR_CODES.TASK_NOT_FOUND,
      `未找到子代理任务: ${taskId}`,
    );
  }
}

async function listTaskFiles(workspacePath: string): Promise<string[]> {
  const dir = getSubagentDir(workspacePath);
  try {
    const entries = await readdir(dir);
    return entries.filter((entry) => entry.endsWith(".json")).map((entry) => path.join(dir, entry));
  } catch {
    return [];
  }
}

async function findRunningTask(workspacePath: string, client: SubagentClient): Promise<SubagentTaskRecord | null> {
  const files = await listTaskFiles(workspacePath);
  for (const file of files) {
    const record = await readTaskRecord(file);
    if (record.client === client && record.status === "running") {
      return record;
    }
  }
  return null;
}

async function updateTaskStatus(
  record: SubagentTaskRecord,
  patch: Partial<SubagentTaskRecord>,
): Promise<SubagentTaskRecord> {
  const next: SubagentTaskRecord = {
    ...record,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await writeTaskRecord(next);
  return next;
}

function detectTaskCompletion(record: SubagentTaskRecord, text: string): SubagentTaskStatus | null {
  if (text.includes(record.failedMarker)) return "failed";
  if (text.includes(record.doneMarker)) return "completed";
  return null;
}

function isHardWatchTransportError(error?: string): boolean {
  if (!error) return false;
  return !error.includes("响应超时") && error !== "__CANCELLED__";
}

async function waitForTaskMarker(
  record: SubagentTaskRecord,
  deadlineMs: number,
  seedText: string,
): Promise<{ status: SubagentTaskStatus | null; paneTail: string }> {
  let paneTail = "";
  const initialStatus = detectTaskCompletion(record, seedText);
  if (initialStatus) {
    return { status: initialStatus, paneTail };
  }

  while (Date.now() < deadlineMs) {
    paneTail = await TmuxSession.capturePane(record.sessionName, 160);
    const status = detectTaskCompletion(record, `${seedText}\n${paneTail}`);
    if (status) {
      return { status, paneTail };
    }
    const remainingMs = deadlineMs - Date.now();
    if (remainingMs <= 0) {
      break;
    }
    await sleep(Math.min(WATCH_POLL_INTERVAL_MS, remainingMs));
  }

  return { status: null, paneTail };
}

function buildInstallHint(client: SubagentClient): string {
  if (client === "codex") {
    return "请先确保本机 `codex --version` 可用，然后重试。";
  }
  return "请先确保本机 `claude --version` 可用（Claude Code CLI），然后重试。";
}

export async function runSubagentTask(input: RunSubagentInput): Promise<RunSubagentResult> {
  const client = assertClient(input.client);
  const workspacePath = resolveWorkspacePath(input.workspace);
  const runningTask = await findRunningTask(workspacePath, client);
  if (runningTask) {
    throw new SubagentRuntimeError(
      SUBAGENT_ERROR_CODES.BUSY,
      `当前 workspace 的 ${client} 子代理已有运行中任务: ${runningTask.taskId}`,
    );
  }

  const groupName = buildGroupName(client, workspacePath);
  const sessionName = TmuxSession.getSessionName(groupName);
  const taskId = randomUUID();
  const now = new Date().toISOString();
  const record: SubagentTaskRecord = {
    taskId,
    client,
    workspacePath,
    groupName,
    sessionName,
    goal: input.goal,
    status: "running",
    doneMarker: buildDoneMarker(taskId),
    failedMarker: buildFailedMarker(taskId),
    createdAt: now,
    updatedAt: now,
    watchMode: input.watch === true,
    taskFile: getTaskFilePath(workspacePath, taskId),
  };
  const prompt = buildDelegationPrompt(record);

  await writeTaskRecord(record);

  let startupMessage = "";
  try {
    startupMessage = await TmuxSession.start(groupName, workspacePath, "tmux", client);
  } catch (error) {
    const startErrorMessage = `${error instanceof Error ? error.message : String(error)}\n${buildInstallHint(client)}`;
    await updateTaskStatus(record, {
      status: "failed",
      completedAt: new Date().toISOString(),
      resultText: startErrorMessage,
    });
    throw new SubagentRuntimeError(SUBAGENT_ERROR_CODES.START_FAILED, startErrorMessage);
  }

  if (input.watch) {
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const deadlineMs = Date.now() + timeoutMs;
    const result = await handleTmuxSend(groupName, prompt, {
      projectDir: workspacePath,
      runnerType: "tmux",
      runnerOld: client,
      timeout: timeoutMs,
    });
    const seedText = [result.response, result.error].filter(Boolean).join("\n");
    const markerResult = await waitForTaskMarker(record, deadlineMs, seedText);

    if (markerResult.status === "completed") {
      const saved = await updateTaskStatus(record, {
        status: "completed",
        completedAt: new Date().toISOString(),
        resultText: result.response ?? result.error,
        lastPaneTail: markerResult.paneTail,
      });
      return {
        task: saved,
        startupMessage,
        watchResult: {
          success: true,
          response: result.response,
        },
      };
    }

    if (markerResult.status === "failed") {
      const saved = await updateTaskStatus(record, {
        status: "failed",
        completedAt: new Date().toISOString(),
        resultText: result.response ?? result.error,
        lastPaneTail: markerResult.paneTail,
      });
      throw new SubagentRuntimeError(
        SUBAGENT_ERROR_CODES.TASK_FAILED,
        `子代理任务失败: ${saved.taskId}`,
      );
    }

    if (isHardWatchTransportError(result.error)) {
      await updateTaskStatus(record, {
        status: "failed",
        completedAt: new Date().toISOString(),
        resultText: result.error,
        lastPaneTail: markerResult.paneTail,
      });
      throw new SubagentRuntimeError(
        SUBAGENT_ERROR_CODES.DELEGATE_FAILED,
        result.error || "子代理任务委派失败",
      );
    }

    const saved = await updateTaskStatus(record, {
      status: "running",
      resultText: result.response ?? result.error,
      lastPaneTail: markerResult.paneTail,
    });
    throw new SubagentRuntimeError(
      SUBAGENT_ERROR_CODES.WATCH_TIMEOUT,
      `子代理 watch 超时，任务仍在运行: ${saved.taskId}。请用 msgcode subagent status ${saved.taskId} --workspace ${saved.workspacePath} 继续查看。`,
    );
  }

  const sendResult = await sendMessage(groupName, prompt);
  if (!sendResult.success) {
    await updateTaskStatus(record, {
      status: "failed",
      completedAt: new Date().toISOString(),
      resultText: sendResult.error,
    });
    throw new SubagentRuntimeError(
      SUBAGENT_ERROR_CODES.DELEGATE_FAILED,
      sendResult.error || "子代理任务发送失败",
    );
  }

  return {
    task: record,
    startupMessage,
  };
}

export async function getSubagentTaskStatus(input: {
  taskId: string;
  workspace?: string;
}): Promise<SubagentStatusResult> {
  const workspacePath = resolveWorkspacePath(input.workspace);
  const taskFile = await findTaskFile(workspacePath, input.taskId);
  const record = await readTaskRecord(taskFile);
  const paneTail = await TmuxSession.capturePane(record.sessionName, 120);
  const detectedStatus = record.status === "running" ? detectTaskCompletion(record, paneTail) : null;
  const next = detectedStatus
    ? await updateTaskStatus(record, {
        status: detectedStatus,
        completedAt: new Date().toISOString(),
        lastPaneTail: paneTail,
      })
    : await updateTaskStatus(record, { lastPaneTail: paneTail });

  return {
    task: next,
    paneTail,
  };
}

export async function stopSubagentTask(input: {
  taskId: string;
  workspace?: string;
}): Promise<SubagentStatusResult> {
  const workspacePath = resolveWorkspacePath(input.workspace);
  const taskFile = await findTaskFile(workspacePath, input.taskId);
  const record = await readTaskRecord(taskFile);

  try {
    await sendEscape(record.groupName);
  } catch (error) {
    logger.warn("subagent stop failed", {
      module: "subagent",
      taskId: record.taskId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new SubagentRuntimeError(
      SUBAGENT_ERROR_CODES.STOP_FAILED,
      error instanceof Error ? error.message : String(error),
    );
  }

  const paneTail = await TmuxSession.capturePane(record.sessionName, 120);
  const next = await updateTaskStatus(record, {
    status: "stopped",
    stoppedAt: new Date().toISOString(),
    lastPaneTail: paneTail,
  });
  return {
    task: next,
    paneTail,
  };
}
