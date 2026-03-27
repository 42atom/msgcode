import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Diagnostic } from "../memory/types.js";
import { readWorkspaceStatusTail, type WorkspaceStatusRecord } from "./status-log.js";
import { readWorkspacePeopleState } from "./workspace-people.js";
import { parseSimpleFrontMatter } from "./simple-front-matter.js";

export interface WorkspaceThreadListItem {
  threadId: string;
  title: string;
  writable: boolean;
  lastTurnAt: string;
}

export interface WorkspaceThreadSummary {
  threadId: string;
  chatId: string;
  title: string;
  source: string;
  writable: boolean;
  filePath: string;
  lastTurnAt: string;
}

export interface WorkspaceThreadMessage {
  turn: number;
  at: string;
  user: string;
  assistant: string;
}

export interface WorkspaceCurrentThread {
  threadId: string;
  title: string;
  writable: boolean;
  lastTurnAt: string;
  messages: WorkspaceThreadMessage[];
}

export interface WorkspaceScheduleItem {
  id: string;
  enabled: boolean;
  cron: string;
  tz: string;
  message: string;
}

export interface WorkspaceThreadSurfaceData {
  workspacePath: string;
  currentThreadId: string;
  threads: WorkspaceThreadListItem[];
  currentThread: WorkspaceCurrentThread | null;
  people: {
    count: number;
  };
  workStatus: {
    updatedAt: string;
    currentThreadEntries: WorkspaceStatusRecord[];
    recentEntries: WorkspaceStatusRecord[];
  };
  schedules: WorkspaceScheduleItem[];
}

export interface WorkspaceThreadDetailSurfaceData {
  workspacePath: string;
  threadId: string;
  thread: WorkspaceCurrentThread | null;
  people: {
    count: number;
  };
  workStatus: {
    updatedAt: string;
    currentThreadEntries: WorkspaceStatusRecord[];
    recentEntries: WorkspaceStatusRecord[];
  };
  schedules: WorkspaceScheduleItem[];
}

export async function readWorkspaceThreadSurface(workspacePath: string): Promise<{ data: WorkspaceThreadSurfaceData; warnings: Diagnostic[] }> {
  const warnings: Diagnostic[] = [];
  const currentChat = await readCurrentChatSelector(path.join(workspacePath, ".msgcode", "config.json"), warnings);
  const threads = await readWorkspaceThreadSummaries(workspacePath, warnings);
  const { data: peopleState, warnings: peopleWarnings } = await readWorkspacePeopleState(workspacePath);
  warnings.push(...peopleWarnings);
  const currentThreadSummary = pickCurrentThread(threads, currentChat);
  const currentThread = currentThreadSummary
    ? await readCurrentThread(currentThreadSummary.filePath, warnings)
    : null;
  const recentStatusEntries = readWorkspaceStatusTail({ workspacePath });
  const currentThreadEntries = filterThreadStatusEntries(recentStatusEntries, currentThread, currentThreadSummary?.source ?? "");
  const schedules = await readSchedules(workspacePath, warnings);

  return {
    data: {
      workspacePath,
      currentThreadId: currentThread?.threadId ?? "",
      threads: threads.map((thread) => ({
        threadId: thread.threadId,
        title: thread.title,
        writable: thread.writable,
        lastTurnAt: thread.lastTurnAt,
      })),
      currentThread,
      people: {
        count: peopleState.people.length,
      },
      workStatus: {
        updatedAt: recentStatusEntries[0]?.timestamp ?? "",
        currentThreadEntries,
        recentEntries: recentStatusEntries,
      },
      schedules,
    },
    warnings,
  };
}

export async function readWorkspaceThreadDetailSurface(
  workspacePath: string,
  threadId: string,
): Promise<{ data: WorkspaceThreadDetailSurfaceData; warnings: Diagnostic[]; found: boolean; readable: boolean }> {
  const warnings: Diagnostic[] = [];
  const normalizedThreadId = normalizeCell(threadId);
  const threads = await readWorkspaceThreadSummaries(workspacePath, warnings);
  const { data: peopleState, warnings: peopleWarnings } = await readWorkspacePeopleState(workspacePath);
  warnings.push(...peopleWarnings);
  const threadSummary = threads.find((thread) => thread.threadId === normalizedThreadId) ?? null;
  const thread = threadSummary
    ? await readCurrentThread(threadSummary.filePath, warnings)
    : null;
  const recentStatusEntries = readWorkspaceStatusTail({ workspacePath });
  const currentThreadEntries = filterThreadStatusEntries(recentStatusEntries, thread, threadSummary?.source ?? "");
  const schedules = await readSchedules(workspacePath, warnings);

  return {
    data: {
      workspacePath,
      threadId: normalizedThreadId,
      thread,
      people: {
        count: peopleState.people.length,
      },
      workStatus: {
        updatedAt: recentStatusEntries[0]?.timestamp ?? "",
        currentThreadEntries,
        recentEntries: recentStatusEntries,
      },
      schedules,
    },
    warnings,
    found: threadSummary !== null,
    readable: thread !== null,
  };
}

async function readCurrentChatSelector(configPath: string, warnings: Diagnostic[]): Promise<{ guid: string; chatId: string; hasConfiguredCurrent: boolean }> {
  if (!existsSync(configPath)) {
    return { guid: "", chatId: "", hasConfiguredCurrent: false };
  }

  try {
    const parsed = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
    const guid = normalizeCell(parsed["runtime.current_chat_guid"]);
    const chatId = normalizeCell(parsed["runtime.current_chat_id"]);
    return {
      guid,
      chatId,
      hasConfiguredCurrent: Boolean(guid || chatId),
    };
  } catch (error) {
    warnings.push({
      code: "APPLIANCE_THREAD_CONFIG_INVALID",
      message: "config.json 不是合法 JSON",
      hint: "修正 .msgcode/config.json",
      details: { configPath, error: error instanceof Error ? error.message : String(error) },
    });
    return { guid: "", chatId: "", hasConfiguredCurrent: false };
  }
}

export async function readWorkspaceThreadSummaries(workspacePath: string, warnings: Diagnostic[]): Promise<WorkspaceThreadSummary[]> {
  const threadsDir = path.join(workspacePath, ".msgcode", "threads");
  if (!existsSync(threadsDir)) {
    return [];
  }

  const fileNames = (await readdir(threadsDir))
    .filter((name) => name.endsWith(".md"))
    .sort((a, b) => a.localeCompare(b, "zh-CN"));

  const threads: WorkspaceThreadSummary[] = [];
  for (const fileName of fileNames) {
    const filePath = path.join(threadsDir, fileName);
    try {
      const content = await readFile(filePath, "utf8");
      const summary = parseThreadSummary(filePath, content);
      if (!summary) {
        warnings.push({
          code: "APPLIANCE_THREAD_INVALID_FILE",
          message: "线程文件解析失败",
          hint: "修正 thread markdown front matter 与 turn 标题",
          details: { filePath },
        });
        continue;
      }
      threads.push(summary);
    } catch (error) {
      warnings.push({
        code: "APPLIANCE_THREAD_READ_FAILED",
        message: "线程文件读取失败",
        hint: "检查线程文件是否可读",
        details: { filePath, error: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  return threads.sort((a, b) => b.lastTurnAt.localeCompare(a.lastTurnAt));
}

function parseThreadSummary(filePath: string, content: string): WorkspaceThreadSummary | null {
  const match = content.match(/^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/);
  if (!match) {
    return null;
  }

  const frontMatter = parseSimpleFrontMatter(match[1] ?? "");
  const threadId = normalizeCell(frontMatter.threadId);
  const chatId = normalizeCell(frontMatter.chatId);
  if (!threadId || !chatId) {
    return null;
  }

  const turnHeaders = Array.from((match[2] ?? "").matchAll(/^## Turn \d+ - (.+)$/gm))
    .map((header) => normalizeCell(header[1]))
    .filter(Boolean);
  if (turnHeaders.length === 0) {
    return null;
  }

  return {
    threadId,
    chatId,
    title: deriveThreadTitle(frontMatter, filePath),
    source: deriveThreadSource(frontMatter, chatId),
    writable: isThreadSourceWritable(deriveThreadSource(frontMatter, chatId)),
    filePath,
    lastTurnAt: turnHeaders.sort((a, b) => b.localeCompare(a))[0] ?? "",
  };
}

async function readCurrentThread(filePath: string, warnings: Diagnostic[]): Promise<WorkspaceCurrentThread | null> {
  try {
    const content = await readFile(filePath, "utf8");
    const match = content.match(/^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/);
    if (!match) {
      warnings.push({
        code: "APPLIANCE_THREAD_INVALID_FILE",
        message: "当前线程文件解析失败",
        hint: "修正当前线程 markdown",
        details: { filePath },
      });
      return null;
    }

    const frontMatter = parseSimpleFrontMatter(match[1] ?? "");
    const threadId = normalizeCell(frontMatter.threadId);
    const chatId = normalizeCell(frontMatter.chatId);
    if (!threadId || !chatId) {
      warnings.push({
        code: "APPLIANCE_THREAD_INVALID_FILE",
        message: "当前线程缺少 front matter 字段",
        hint: "补齐 threadId / chatId",
        details: { filePath },
      });
      return null;
    }

    const messages = parseThreadMessages(match[2] ?? "");
    if (messages.length === 0) {
      warnings.push({
        code: "APPLIANCE_THREAD_INVALID_FILE",
        message: "当前线程缺少完整 turn",
        hint: "补齐 ## Turn / ### User / ### Assistant",
        details: { filePath },
      });
      return null;
    }

    return {
      threadId,
      title: deriveThreadTitle(frontMatter, filePath),
      writable: isThreadSourceWritable(deriveThreadSource(frontMatter, chatId)),
      lastTurnAt: messages[0]?.at ?? "",
      messages,
    };
  } catch (error) {
    warnings.push({
      code: "APPLIANCE_THREAD_READ_FAILED",
      message: "当前线程文件读取失败",
      hint: "检查当前线程文件是否可读",
      details: { filePath, error: error instanceof Error ? error.message : String(error) },
    });
    return null;
  }
}

function parseThreadMessages(body: string): WorkspaceThreadMessage[] {
  const sections = body
    .split(/^## Turn /m)
    .map((section) => section.trim())
    .filter(Boolean);

  const messages: WorkspaceThreadMessage[] = [];
  for (const section of sections) {
    const lines = section.split(/\r?\n/);
    const header = lines.shift() ?? "";
    const headerMatch = header.match(/^(\d+)\s+-\s+(.+)$/);
    if (!headerMatch) continue;
    const turn = Number.parseInt(headerMatch[1] ?? "", 10);
    const at = normalizeCell(headerMatch[2]);
    const userMatch = section.match(/### User\n([\s\S]*?)\n\n### Assistant\n/);
    const assistantMatch = section.match(/### Assistant\n([\s\S]*)$/);
    const user = normalizeCell((userMatch?.[1] ?? "").replace(/\n+/g, " "));
    const assistant = normalizeCell((assistantMatch?.[1] ?? "").replace(/\n+/g, " "));
    if (!at || !user || !assistant) {
      continue;
    }
    messages.push({ turn, at, user, assistant });
  }

  return messages.sort((a, b) => b.at.localeCompare(a.at));
}

function deriveThreadTitle(frontMatter: Record<string, string>, filePath: string): string {
  const explicitTitle = normalizeCell(frontMatter.title);
  if (explicitTitle) {
    return explicitTitle;
  }

  const baseName = path.basename(filePath, ".md");
  const title = baseName.replace(/^\d{4}-\d{2}-\d{2}_/, "");
  return title.trim() || baseName;
}

function deriveThreadSource(frontMatter: Record<string, string>, chatId: string): string {
  const explicitTransport = normalizeCell(frontMatter.transport).toLowerCase();
  if (explicitTransport) {
    return explicitTransport;
  }

  const raw = chatId.toLowerCase();
  if (raw.startsWith("feishu:")) return "feishu";
  if (raw.startsWith("web:")) return "web";
  if (raw.startsWith("neighbor:")) return "neighbor";
  return "unknown";
}

export function isThreadSourceWritable(source: string): boolean {
  return source === "web";
}

function deriveThreadStatusLabel(source: string): string {
  if (source === "feishu") return "飞书线程";
  if (source === "web") return "网页线程";
  if (source === "neighbor") return "邻居线程";
  return "";
}

function filterThreadStatusEntries(
  recentStatusEntries: WorkspaceStatusRecord[],
  thread: WorkspaceCurrentThread | null,
  threadSource: string,
): WorkspaceStatusRecord[] {
  if (!thread) {
    return [];
  }

  const sourceLabel = deriveThreadStatusLabel(threadSource);
  return recentStatusEntries.filter((entry) => entry.thread === thread.title || (sourceLabel !== "" && entry.thread === sourceLabel));
}

function pickCurrentThread(threads: WorkspaceThreadSummary[], currentChat: { guid: string; chatId: string; hasConfiguredCurrent: boolean }): WorkspaceThreadSummary | null {
  if (threads.length === 0) {
    return null;
  }

  if (currentChat.guid) {
    const matchedByGuid = threads.find((thread) => thread.chatId === currentChat.guid);
    if (matchedByGuid) {
      return matchedByGuid;
    }
  }

  if (currentChat.chatId) {
    const matchedByChatId = threads.find((thread) => thread.chatId === currentChat.chatId || thread.chatId === `feishu:${currentChat.chatId}`);
    if (matchedByChatId) {
      return matchedByChatId;
    }
  }

  if (currentChat.hasConfiguredCurrent) {
    return null;
  }

  return threads[0] ?? null;
}

async function readSchedules(workspacePath: string, warnings: Diagnostic[]): Promise<WorkspaceScheduleItem[]> {
  const schedulesDir = path.join(workspacePath, ".msgcode", "schedules");
  if (!existsSync(schedulesDir)) {
    return [];
  }

  const files = (await readdir(schedulesDir))
    .filter((name) => name.endsWith(".json"))
    .sort((a, b) => a.localeCompare(b, "zh-CN"));

  const schedules: WorkspaceScheduleItem[] = [];
  for (const fileName of files) {
    const sourcePath = path.join(schedulesDir, fileName);
    try {
      const parsed = JSON.parse(await readFile(sourcePath, "utf8")) as Record<string, unknown>;
      const cron = normalizeCell(parsed.cron);
      const message = normalizeCell(parsed.message);
      if (!cron || !message) {
        warnings.push({
          code: "APPLIANCE_SCHEDULE_INCOMPLETE",
          message: "schedule 文件缺少关键字段",
          hint: "补齐 cron / message",
          details: { sourcePath },
        });
        continue;
      }

      schedules.push({
        id: fileName.replace(/\.json$/, ""),
        enabled: parsed.enabled !== false,
        cron,
        tz: normalizeCell(parsed.tz),
        message,
      });
    } catch (error) {
      warnings.push({
        code: "APPLIANCE_SCHEDULE_INVALID_JSON",
        message: "schedule 文件不是合法 JSON",
        hint: "修正 schedules/*.json",
        details: { sourcePath, error: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  return schedules;
}

function normalizeCell(value: unknown): string {
  return String(value ?? "").trim();
}
