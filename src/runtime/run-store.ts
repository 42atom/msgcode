/**
 * msgcode: Run Core 最小持久化与日志（Phase 1/2）
 *
 * 职责：
 * - 为 message / task / heartbeat / schedule 提供统一 runId
 * - 将 run lifecycle 追加到 JSONL
 * - 输出结构化日志，保证 runId/sessionKey/source/status 可观测
 *
 * 约束：
 * - 只做最小持久化与日志
 * - Phase 2 只补最小 sessionKey，不新增 manager / 控制层
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { logger } from "../logger/index.js";
import type {
    CreateRunInput,
    FinishRunInput,
    RunKind,
    RunRecord,
    RunStatus,
} from "./run-types.js";
import { emitRunEvent } from "./run-events.js";
import { resolveSession } from "./session-key.js";

/**
 * 默认 run 日志路径
 */
export function getDefaultRunLogPath(): string {
    const envPath = (process.env.MSGCODE_RUNS_FILE_PATH || "").trim();
    if (envPath) {
        return envPath;
    }
    return path.join(os.homedir(), ".config", "msgcode", "run-core", "runs.jsonl");
}

/**
 * RunStore 配置
 */
export interface RunStoreConfig {
    runsPath?: string;
}

/**
 * RunHandle：代表当前正在执行的单个 run
 */
export interface RunHandle {
    runId: string;
    sessionKey: string;
    source: CreateRunInput["source"];
    kind: RunKind;
    startedAt: number;
    chatId?: string;
    workspacePath?: string;
    taskId?: string;
    triggerId?: string;
    finish(input: FinishRunInput): RunRecord;
}

/**
 * 将未知错误规范成可落盘文本
 */
export function toRunErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

class RunHandleImpl implements RunHandle {
    public readonly runId: string;
    public readonly sessionKey: string;
    public readonly source: CreateRunInput["source"];
    public readonly kind: RunKind;
    public readonly startedAt: number;
    public readonly chatId?: string;
    public readonly workspacePath?: string;
    public readonly taskId?: string;
    public readonly triggerId?: string;

    private readonly store: RunStore;
    private finished = false;
    private finalRecord: RunRecord | null = null;

    constructor(store: RunStore, input: CreateRunInput) {
        const resolvedSession = resolveSession(input);
        this.store = store;
        this.runId = randomUUID();
        this.sessionKey = resolvedSession.sessionKey;
        this.source = input.source;
        this.kind = input.kind ?? "light";
        this.startedAt = Date.now();
        this.chatId = input.chatId;
        this.workspacePath = input.workspacePath ?? resolvedSession.workspacePath;
        this.taskId = input.taskId;
        this.triggerId = input.triggerId;

        this.store.append(
            this.buildRecord({
                status: "accepted",
                loggedAt: this.startedAt,
            })
        );
        this.store.append(
            this.buildRecord({
                status: "running",
                loggedAt: Date.now(),
            })
        );
        emitRunEvent({
            runId: this.runId,
            sessionKey: this.sessionKey,
            source: this.source,
            type: "run:start",
            timestamp: this.startedAt,
            kind: this.kind,
            status: "running",
            chatId: this.chatId,
            workspacePath: this.workspacePath,
            taskId: this.taskId,
            triggerId: this.triggerId,
        });
    }

    finish(input: FinishRunInput): RunRecord {
        if (this.finished && this.finalRecord) {
            return this.finalRecord;
        }

        const endedAt = Date.now();
        const record = this.buildRecord({
            status: input.status,
            loggedAt: endedAt,
            endedAt,
            durationMs: endedAt - this.startedAt,
            chatId: input.chatId,
            workspacePath: input.workspacePath,
            taskId: input.taskId,
            triggerId: input.triggerId,
            error: input.error,
        });

        this.store.append(record);
        if (input.status === "failed") {
            emitRunEvent({
                runId: this.runId,
                sessionKey: this.sessionKey,
                source: this.source,
                type: "run:error",
                timestamp: endedAt,
                kind: this.kind,
                status: input.status,
                chatId: record.chatId,
                workspacePath: record.workspacePath,
                taskId: record.taskId,
                triggerId: record.triggerId,
                error: record.error,
            });
        }
        emitRunEvent({
            runId: this.runId,
            sessionKey: this.sessionKey,
            source: this.source,
            type: "run:end",
            timestamp: endedAt,
            kind: this.kind,
            status: input.status,
            chatId: record.chatId,
            workspacePath: record.workspacePath,
            taskId: record.taskId,
            triggerId: record.triggerId,
            error: record.error,
            details: {
                durationMs: record.durationMs,
            },
        });
        this.finished = true;
        this.finalRecord = record;
        return record;
    }

    private buildRecord(input: {
        status: RunStatus;
        loggedAt: number;
        endedAt?: number;
        durationMs?: number;
        chatId?: string;
        workspacePath?: string;
        taskId?: string;
        triggerId?: string;
        error?: string;
    }): RunRecord {
        return {
            runId: this.runId,
            sessionKey: this.sessionKey,
            source: this.source,
            kind: this.kind,
            status: input.status,
            startedAt: this.startedAt,
            endedAt: input.endedAt,
            durationMs: input.durationMs,
            chatId: input.chatId ?? this.chatId,
            workspacePath: input.workspacePath ?? this.workspacePath,
            taskId: input.taskId ?? this.taskId,
            triggerId: input.triggerId ?? this.triggerId,
            error: input.error,
            loggedAt: input.loggedAt,
        };
    }
}

/**
 * 最小 RunStore
 *
 * 只负责 JSONL 追加，不做查询控制面。
 */
export class RunStore {
    private readonly runsPath: string;

    constructor(config: RunStoreConfig = {}) {
        this.runsPath = config.runsPath ?? getDefaultRunLogPath();
        this.ensureDir();
    }

    beginRun(input: CreateRunInput): RunHandle {
        return new RunHandleImpl(this, input);
    }

    append(record: RunRecord): void {
        try {
            fs.appendFileSync(this.runsPath, `${JSON.stringify(record)}\n`, "utf-8");
            logger.info("run lifecycle", this.buildLogMeta(record));
        } catch (error) {
            logger.error("run lifecycle append failed", {
                module: "runtime/run-store",
                runId: record.runId,
                sessionKey: record.sessionKey,
                source: record.source,
                status: record.status,
                error: toRunErrorMessage(error),
                runsPath: this.runsPath,
            });
        }
    }

    private ensureDir(): void {
        fs.mkdirSync(path.dirname(this.runsPath), { recursive: true });
    }

    private buildLogMeta(record: RunRecord): Record<string, unknown> {
        return {
            module: "runtime/run-store",
            runId: record.runId,
            sessionKey: record.sessionKey,
            source: record.source,
            status: record.status,
            kind: record.kind,
            chatId: record.chatId,
            taskId: record.taskId,
            triggerId: record.triggerId,
            startedAt: record.startedAt,
            endedAt: record.endedAt,
            durationMs: record.durationMs,
            error: record.error,
        };
    }
}

let activeRunStore: RunStore | null = null;

function getActiveRunStore(): RunStore {
    if (!activeRunStore) {
        activeRunStore = new RunStore();
    }
    return activeRunStore;
}

/**
 * 统一创建一个新的 run
 */
export function beginRun(input: CreateRunInput): RunHandle {
    return getActiveRunStore().beginRun(input);
}

/**
 * 仅供测试重置全局 store，避免 env 路径缓存。
 */
export function resetRunStoreForTest(): void {
    activeRunStore = null;
}

/**
 * 仅供测试读取当前 runsPath
 */
export function getActiveRunLogPathForTest(): string {
    return getDefaultRunLogPath();
}
