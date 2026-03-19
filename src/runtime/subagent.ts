/**
 * msgcode: subagent runtime（MVP）
 *
 * 设计目标：
 * - 只提供最小正式合同：run / status / stop
 * - 直接复用现有 tmux 执行臂，不新增控制面
 * - 任务状态只落盘到 workspace/.msgcode/subagents/*.json
 */

import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { getWorkspacePath } from "../cli/command-runner.js";
import { logger } from "../logger/index.js";
import { handleTmuxSend } from "../tmux/responder.js";
import { sendEscape, sendMessage } from "../tmux/sender.js";
import { TmuxSession } from "../tmux/session.js";
import { atomicWriteFile } from "./fs-atomic.js";

interface SubagentRuntimeDeps {
  tmuxSession: typeof TmuxSession;
  handleTmuxSend: typeof handleTmuxSend;
  sendEscape: typeof sendEscape;
  sendMessage: typeof sendMessage;
}

const subagentRuntimeDeps: SubagentRuntimeDeps = {
  tmuxSession: TmuxSession,
  handleTmuxSend,
  sendEscape,
  sendMessage,
};

const defaultSubagentRuntimeDeps: SubagentRuntimeDeps = {
  ...subagentRuntimeDeps,
};

export function __setSubagentTestDeps(overrides: Partial<SubagentRuntimeDeps>): void {
  if (overrides.tmuxSession) subagentRuntimeDeps.tmuxSession = overrides.tmuxSession;
  if (overrides.handleTmuxSend) subagentRuntimeDeps.handleTmuxSend = overrides.handleTmuxSend;
  if (overrides.sendEscape) subagentRuntimeDeps.sendEscape = overrides.sendEscape;
  if (overrides.sendMessage) subagentRuntimeDeps.sendMessage = overrides.sendMessage;
}

export function __resetSubagentTestDeps(): void {
  subagentRuntimeDeps.tmuxSession = defaultSubagentRuntimeDeps.tmuxSession;
  subagentRuntimeDeps.handleTmuxSend = defaultSubagentRuntimeDeps.handleTmuxSend;
  subagentRuntimeDeps.sendEscape = defaultSubagentRuntimeDeps.sendEscape;
  subagentRuntimeDeps.sendMessage = defaultSubagentRuntimeDeps.sendMessage;
}

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
  NOT_RUNNING: "SUBAGENT_NOT_RUNNING",
} as const;

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const WATCH_POLL_INTERVAL_MS = 1500;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface SubagentTaskRecord {
  taskId: string;
  client: SubagentClient;
  workspacePath: string;
  groupName: string;
  sessionName: string;
  goal: string;
  persona?: string;
  taskCard?: SubagentTaskCard;
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
  messagesFile?: string;
  taskFile: string;
}

export interface SubagentMessageRecord {
  messageId: string;
  taskId: string;
  direction: "to-subagent" | "from-subagent";
  body: string;
  createdAt: string;
  relatedMessageId?: string;
}

export interface RunSubagentInput {
  client: string;
  goal: string;
  persona?: string;
  taskCard?: SubagentTaskCard;
  workspace?: string;
  watch?: boolean;
  timeoutMs?: number;
}

export interface SubagentTaskCard {
  cwd?: string;
  constraints?: string[];
  acceptance?: string[];
  verification?: string[];
  artifacts?: string[];
  parentTask?: string;
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

export interface SendSubagentMessageResult {
  task: SubagentTaskRecord;
  messageId: string;
  messagesFile: string;
  response?: string;
}

export interface ListSubagentTasksResult {
  workspacePath: string;
  tasks: SubagentTaskRecord[];
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

function getTaskMessagesFilePath(workspacePath: string, taskId: string): string {
  return path.join(getSubagentDir(workspacePath), `${taskId}.messages.ndjson`);
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

function getPersonaPath(personaId: string): string {
  return path.join(REPO_ROOT, "docs", "protocol", "personas", `${personaId}.md`);
}

async function loadPersonaContent(personaId?: string): Promise<string | undefined> {
  if (!personaId) {
    return undefined;
  }
  const personaPath = getPersonaPath(personaId);
  try {
    const content = await readFile(personaPath, "utf8");
    return content.trim();
  } catch {
    throw new SubagentRuntimeError(
      SUBAGENT_ERROR_CODES.DELEGATE_FAILED,
      `persona 文档不存在: ${personaPath}`,
    );
  }
}

function formatTaskCard(taskCard?: SubagentTaskCard): string[] {
  if (!taskCard) {
    return [];
  }

  const lines: string[] = ["task_card:"];
  if (taskCard.cwd) lines.push(`- cwd: ${taskCard.cwd}`);
  if (taskCard.parentTask) lines.push(`- parent_task: ${taskCard.parentTask}`);
  if (taskCard.constraints?.length) {
    lines.push("- constraints:");
    for (const item of taskCard.constraints) lines.push(`  - ${item}`);
  }
  if (taskCard.acceptance?.length) {
    lines.push("- acceptance:");
    for (const item of taskCard.acceptance) lines.push(`  - ${item}`);
  }
  if (taskCard.verification?.length) {
    lines.push("- verification:");
    for (const item of taskCard.verification) lines.push(`  - ${item}`);
  }
  if (taskCard.artifacts?.length) {
    lines.push("- artifacts:");
    for (const item of taskCard.artifacts) lines.push(`  - ${item}`);
  }
  return lines;
}

function extractTaskIds(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return Array.from(new Set(value.match(/\btk\d{4}\b/gi)?.map((id) => id.toLowerCase()) ?? []));
}

function stripFrontMatter(content: string): string {
  return content.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
}

function extractFirstParagraph(content: string): string | undefined {
  const lines = stripFrontMatter(content).split("\n");
  const paragraph: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (paragraph.length > 0) {
        break;
      }
      continue;
    }
    if (line.startsWith("#") || line.startsWith("```") || line.startsWith("---")) {
      continue;
    }
    if (line.startsWith("- ") || /^\d+\.\s/.test(line)) {
      continue;
    }
    paragraph.push(line);
  }

  if (paragraph.length === 0) {
    return undefined;
  }

  return paragraph.join(" ").slice(0, 240);
}

function extractParentTaskId(taskContent: string): string | undefined {
  const parentSectionMatch = taskContent.match(/##\s+Parent Task\s*\n([\s\S]*?)(?=\n#{1,2}\s|$)/i);
  const parentIds = extractTaskIds(parentSectionMatch?.[1]);
  return parentIds[0];
}

async function findIssueFileByTaskId(workspacePath: string, taskId: string): Promise<string | undefined> {
  const issuesDir = path.join(workspacePath, "issues");
  try {
    const entries = await readdir(issuesDir);
    const matched = entries.find((entry) => entry.startsWith(`${taskId}.`) && entry.endsWith(".md"));
    return matched ? path.join(issuesDir, matched) : undefined;
  } catch {
    return undefined;
  }
}

async function loadDelegationContext(record: SubagentTaskRecord): Promise<string[]> {
  const currentTaskId = record.taskCard?.parentTask;
  if (!currentTaskId) {
    return [];
  }

  const lines: string[] = [];
  const currentTaskPath = await findIssueFileByTaskId(record.workspacePath, currentTaskId);
  if (currentTaskPath) {
    try {
      const currentTaskContent = await readFile(currentTaskPath, "utf8");
      const parentTaskId = extractParentTaskId(currentTaskContent);
      if (parentTaskId) {
        const parentTaskPath = await findIssueFileByTaskId(record.workspacePath, parentTaskId);
        if (parentTaskPath) {
          const parentTaskContent = await readFile(parentTaskPath, "utf8");
          const parentSummary = extractFirstParagraph(parentTaskContent);
          if (parentSummary) {
            lines.push("parent_task_summary:");
            lines.push(parentSummary);
            lines.push("");
          }
        }
      }
    } catch {
      // ignore: keep prompt thin and best-effort
    }
  }

  const evidencePath = path.join(record.workspacePath, ".msgcode", "evidence", `${currentTaskId}.json`);
  try {
    const evidenceContent = await readFile(evidencePath, "utf8");
    const evidence = JSON.parse(evidenceContent) as {
      exitCode?: number;
      commands?: Array<{ ok?: boolean; stderr?: string; exitCode?: number }>;
    };
    const failingCommand = evidence.commands?.find((item) => item.ok === false) ?? evidence.commands?.at(-1);
    if (typeof evidence.exitCode === "number" && failingCommand) {
      const stderrPreview = (failingCommand.stderr || "").replace(/\s+/g, " ").trim().slice(0, 200);
      lines.push("recent_failure_evidence:");
      lines.push(`- exit_code: ${evidence.exitCode}`);
      if (stderrPreview) {
        lines.push(`- stderr: ${stderrPreview}`);
      }
      lines.push("");
    }
  } catch {
    // ignore: no evidence is a normal case
  }

  return lines;
}

function buildDelegationPrompt(record: SubagentTaskRecord, personaContent?: string, delegationContext: string[] = []): string {
  const lines = [
    "你现在是 msgcode 的子代理执行臂。",
    "请只执行任务，不要反问，不要汇报长过程。",
    "",
    `task_id: ${record.taskId}`,
    `workspace: ${record.workspacePath}`,
    `client: ${record.client}`,
    ...(record.persona ? [`persona: ${record.persona}`] : []),
    "",
    "goal:",
    record.goal.trim(),
    "",
    ...formatTaskCard(record.taskCard),
    ...(record.taskCard ? [""] : []),
    ...delegationContext,
    ...(personaContent ? ["persona_doc:", personaContent, ""] : []),
    "完成协议：",
    `- 成功完成后，最后单独输出一行：${record.doneMarker}`,
    `- 若确定无法完成，最后单独输出一行：${record.failedMarker}`,
    "- 除了上面的标记行，不要改写标记文本。",
  ];
  return lines.join("\n");
}

async function ensureSubagentDir(workspacePath: string): Promise<void> {
  await mkdir(getSubagentDir(workspacePath), { recursive: true });
}

async function writeTaskRecord(record: SubagentTaskRecord): Promise<void> {
  await ensureSubagentDir(record.workspacePath);
  await atomicWriteFile(record.taskFile, JSON.stringify(record, null, 2));
}

async function appendMessageRecord(workspacePath: string, taskId: string, entry: SubagentMessageRecord): Promise<void> {
  await ensureSubagentDir(workspacePath);
  await appendFile(getTaskMessagesFilePath(workspacePath, taskId), `${JSON.stringify(entry)}\n`, "utf8");
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

async function loadTaskRecords(workspacePath: string): Promise<SubagentTaskRecord[]> {
  const files = await listTaskFiles(workspacePath);
  const records = await Promise.all(files.map((file) => readTaskRecord(file)));
  records.sort((a, b) => {
    const lhs = Date.parse(b.updatedAt || b.createdAt || "");
    const rhs = Date.parse(a.updatedAt || a.createdAt || "");
    return lhs - rhs;
  });
  return records;
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
    paneTail = await subagentRuntimeDeps.tmuxSession.capturePane(record.sessionName, 160);
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
  const sessionName = subagentRuntimeDeps.tmuxSession.getSessionName(groupName);
  const taskId = randomUUID();
  const now = new Date().toISOString();
  const record: SubagentTaskRecord = {
    taskId,
    client,
    workspacePath,
    groupName,
    sessionName,
    goal: input.goal,
    persona: input.persona,
    taskCard: input.taskCard,
    status: "running",
    doneMarker: buildDoneMarker(taskId),
    failedMarker: buildFailedMarker(taskId),
    createdAt: now,
    updatedAt: now,
    watchMode: input.watch === true,
    messagesFile: getTaskMessagesFilePath(workspacePath, taskId),
    taskFile: getTaskFilePath(workspacePath, taskId),
  };
  const personaContent = await loadPersonaContent(input.persona);
  const delegationContext = await loadDelegationContext(record);
  const prompt = buildDelegationPrompt(record, personaContent, delegationContext);

  await writeTaskRecord(record);

  let startupMessage = "";
  try {
    startupMessage = await subagentRuntimeDeps.tmuxSession.start(groupName, workspacePath, "tmux", client);
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
    const result = await subagentRuntimeDeps.handleTmuxSend(groupName, prompt, {
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

  const sendResult = await subagentRuntimeDeps.sendMessage(groupName, prompt);
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
  const paneTail = await subagentRuntimeDeps.tmuxSession.capturePane(record.sessionName, 120);
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

export async function sendSubagentMessage(input: {
  taskId: string;
  message: string;
  workspace?: string;
  watch?: boolean;
  timeoutMs?: number;
}): Promise<SendSubagentMessageResult> {
  const workspacePath = resolveWorkspacePath(input.workspace);
  const taskFile = await findTaskFile(workspacePath, input.taskId);
  let record = await readTaskRecord(taskFile);

  if (record.status !== "running") {
    throw new SubagentRuntimeError(
      SUBAGENT_ERROR_CODES.NOT_RUNNING,
      `子代理任务未运行，无法继续对话: ${record.taskId} (${record.status})`,
    );
  }

  const messageId = randomUUID();
  const createdAt = new Date().toISOString();
  const trimmedMessage = input.message.trim();
  if (!trimmedMessage) {
    throw new SubagentRuntimeError(
      SUBAGENT_ERROR_CODES.DELEGATE_FAILED,
      "消息不能为空",
    );
  }

  await appendMessageRecord(workspacePath, record.taskId, {
    messageId,
    taskId: record.taskId,
    direction: "to-subagent",
    body: trimmedMessage,
    createdAt,
  });

  if (input.watch) {
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const result = await subagentRuntimeDeps.handleTmuxSend(record.groupName, trimmedMessage, {
      projectDir: workspacePath,
      runnerType: "tmux",
      runnerOld: record.client,
      timeout: timeoutMs,
    });

    if (isHardWatchTransportError(result.error)) {
      throw new SubagentRuntimeError(
        SUBAGENT_ERROR_CODES.DELEGATE_FAILED,
        result.error || "子代理消息发送失败",
      );
    }

    const paneTail = await subagentRuntimeDeps.tmuxSession.capturePane(record.sessionName, 160);
    const detectedStatus = detectTaskCompletion(record, `${result.response ?? ""}\n${paneTail}`);
    record = detectedStatus
      ? await updateTaskStatus(record, {
          status: detectedStatus,
          completedAt: new Date().toISOString(),
          lastPaneTail: paneTail,
          resultText: result.response ?? result.error,
        })
      : await updateTaskStatus(record, {
          lastPaneTail: paneTail,
          resultText: result.response ?? result.error,
        });

    if (result.response?.trim()) {
      await appendMessageRecord(workspacePath, record.taskId, {
        messageId: randomUUID(),
        taskId: record.taskId,
        direction: "from-subagent",
        body: result.response,
        createdAt: new Date().toISOString(),
        relatedMessageId: messageId,
      });
    }

    return {
      task: record,
      messageId,
      messagesFile: record.messagesFile || getTaskMessagesFilePath(workspacePath, record.taskId),
      response: result.response,
    };
  }

  const sendResult = await subagentRuntimeDeps.sendMessage(record.groupName, trimmedMessage);
  if (!sendResult.success) {
    throw new SubagentRuntimeError(
      SUBAGENT_ERROR_CODES.DELEGATE_FAILED,
      sendResult.error || "子代理消息发送失败",
    );
  }

  record = await updateTaskStatus(record, {});
  return {
    task: record,
    messageId,
    messagesFile: record.messagesFile || getTaskMessagesFilePath(workspacePath, record.taskId),
  };
}

export async function listSubagentTasks(input?: {
  workspace?: string;
  client?: string;
  status?: SubagentTaskStatus;
}): Promise<ListSubagentTasksResult> {
  const workspacePath = resolveWorkspacePath(input?.workspace);
  const client = input?.client ? assertClient(input.client) : null;
  const records = await loadTaskRecords(workspacePath);
  const tasks = records.filter((record) => {
    if (client && record.client !== client) return false;
    if (input?.status && record.status !== input.status) return false;
    return true;
  });

  return {
    workspacePath,
    tasks,
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
    await subagentRuntimeDeps.sendEscape(record.groupName);
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

  const paneTail = await subagentRuntimeDeps.tmuxSession.capturePane(record.sessionName, 120);
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
