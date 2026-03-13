/**
 * msgcode: Run Events（Phase 4）
 *
 * 职责：
 * - 为 Run Core 提供最小 append-only 事件落盘
 * - 统一输出 run:start / run:tool / run:assistant / run:block / run:end / run:error
 *
 * 约束：
 * - 只做文件落盘与最小日志，不做 event bus / socket hub
 * - 事件必须附着在现有 run 上，不新增 manager 层
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { logger } from "../logger/index.js";
import type { RunKind, RunSource, RunTerminalStatus } from "./run-types.js";

export type RunEventType =
    | "run:start"
    | "run:tool"
    | "run:assistant"
    | "run:block"
    | "run:end"
    | "run:error";

export interface RunEventRecord {
    eventId: string;
    runId: string;
    sessionKey: string;
    source: RunSource;
    type: RunEventType;
    timestamp: number;
    kind?: RunKind;
    status?: "running" | RunTerminalStatus;
    chatId?: string;
    workspacePath?: string;
    taskId?: string;
    triggerId?: string;
    toolName?: string;
    ok?: boolean;
    error?: string;
    errorCode?: string;
    message?: string;
    route?: string;
    details?: Record<string, unknown>;
}

export interface CreateRunEventInput {
    runId: string;
    sessionKey: string;
    source: RunSource;
    type: RunEventType;
    timestamp?: number;
    kind?: RunKind;
    status?: "running" | RunTerminalStatus;
    chatId?: string;
    workspacePath?: string;
    taskId?: string;
    triggerId?: string;
    toolName?: string;
    ok?: boolean;
    error?: string;
    errorCode?: string;
    message?: string;
    route?: string;
    details?: Record<string, unknown>;
}

type ToolLoopActEntry = {
    phase: string;
    timestamp: number;
    route: string;
    tool: string;
    ok: boolean;
    stepId: number;
    durationMs: number;
    errorCode?: string;
    errorMessage?: string;
    exitCode?: number | null;
};

type ToolLoopVerifyResult = {
    ok: boolean;
    failureReason?: string;
    errorCode?: string;
};

export function getDefaultRunEventsPath(): string {
    const envPath = (process.env.MSGCODE_RUN_EVENTS_FILE_PATH || "").trim();
    if (envPath) {
        return envPath;
    }
    return path.join(os.homedir(), ".config", "msgcode", "run-core", "run-events.jsonl");
}

interface RunEventStoreConfig {
    eventsPath?: string;
}

class RunEventStore {
    private readonly eventsPath: string;

    constructor(config: RunEventStoreConfig = {}) {
        this.eventsPath = config.eventsPath ?? getDefaultRunEventsPath();
        this.ensureDir();
    }

    append(record: RunEventRecord): void {
        try {
            fs.appendFileSync(this.eventsPath, `${JSON.stringify(record)}\n`, "utf-8");
            logger.info("run event", {
                module: "runtime/run-events",
                eventId: record.eventId,
                runId: record.runId,
                sessionKey: record.sessionKey,
                source: record.source,
                type: record.type,
                status: record.status,
                toolName: record.toolName,
                ok: record.ok,
                errorCode: record.errorCode,
                taskId: record.taskId,
                triggerId: record.triggerId,
            });
        } catch (error) {
            logger.error("run event append failed", {
                module: "runtime/run-events",
                runId: record.runId,
                sessionKey: record.sessionKey,
                source: record.source,
                type: record.type,
                error: error instanceof Error ? error.message : String(error),
                eventsPath: this.eventsPath,
            });
        }
    }

    private ensureDir(): void {
        fs.mkdirSync(path.dirname(this.eventsPath), { recursive: true });
    }
}

let activeRunEventStore: RunEventStore | null = null;

function getActiveRunEventStore(): RunEventStore {
    if (!activeRunEventStore) {
        activeRunEventStore = new RunEventStore();
    }
    return activeRunEventStore;
}

export function emitRunEvent(input: CreateRunEventInput): RunEventRecord {
    const record: RunEventRecord = {
        eventId: randomUUID(),
        runId: input.runId,
        sessionKey: input.sessionKey,
        source: input.source,
        type: input.type,
        timestamp: input.timestamp ?? Date.now(),
        kind: input.kind,
        status: input.status,
        chatId: input.chatId,
        workspacePath: input.workspacePath,
        taskId: input.taskId,
        triggerId: input.triggerId,
        toolName: input.toolName,
        ok: input.ok,
        error: input.error,
        errorCode: input.errorCode,
        message: input.message,
        route: input.route,
        details: input.details,
    };
    getActiveRunEventStore().append(record);
    return record;
}

export function emitToolLoopRunEvents(params: {
    runId: string;
    sessionKey: string;
    source: RunSource;
    answer: string;
    route: "no-tool" | "tool";
    actionJournal: ToolLoopActEntry[];
    verifyResult?: ToolLoopVerifyResult;
}): void {
    const toolEntries = params.actionJournal.filter((entry) => entry.phase === "act");

    for (const entry of toolEntries) {
        const errorMessage = entry.errorMessage ? clipRunEventText(entry.errorMessage, 240) : "";
        emitRunEvent({
            runId: params.runId,
            sessionKey: params.sessionKey,
            source: params.source,
            type: "run:tool",
            timestamp: entry.timestamp,
            toolName: entry.tool,
            ok: entry.ok,
            errorCode: entry.errorCode,
            route: entry.route,
            details: {
                stepId: entry.stepId,
                durationMs: entry.durationMs,
                exitCode: entry.exitCode ?? undefined,
                ...(errorMessage ? { errorMessage } : {}),
            },
        });
    }

    const answerPreview = clipRunEventText(params.answer, 400);
    if (answerPreview) {
        emitRunEvent({
            runId: params.runId,
            sessionKey: params.sessionKey,
            source: params.source,
            type: "run:assistant",
            message: answerPreview,
            route: params.route,
            details: {
                responseLength: params.answer.length,
                toolCallCount: toolEntries.length,
            },
        });
    }

}

export function resetRunEventStoreForTest(): void {
    activeRunEventStore = null;
}

function clipRunEventText(text: string, maxChars: number): string {
    const normalized = (text || "").trim();
    if (!normalized) return "";
    if (normalized.length <= maxChars) return normalized;
    if (maxChars <= 16) return normalized.slice(0, maxChars);
    return `${normalized.slice(0, maxChars - 14)}...(truncated)`;
}
