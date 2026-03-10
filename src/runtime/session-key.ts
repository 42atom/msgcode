/**
 * msgcode: Run Core sessionKey 解析（Phase 2）
 *
 * 目标：
 * - 让 message / task / heartbeat / schedule 落到同一套稳定 session 语义
 * - sessionKey 不再只是 chatId 别名
 * - schedule 缺少 route/workspace 时走 fail-closed 的 orphan key，而不是猜工作区
 */

import { createHash } from "node:crypto";
import path from "node:path";
import { normalizeChatId } from "../imsg/adapter.js";
import { getRouteByChatId } from "../routes/store.js";
import type { RunSource } from "./run-types.js";

export type SessionChannel = "imessage" | "feishu" | "telegram" | "discord" | "unknown";

export interface ResolveSessionInput {
    source: RunSource;
    chatId?: string;
    workspacePath?: string;
}

export interface ResolvedSession {
    sessionKey: string;
    channel: SessionChannel;
    normalizedChatId?: string;
    workspacePath?: string;
}

export function resolveSessionChannel(chatId?: string): SessionChannel {
    const raw = (chatId || "").trim().toLowerCase();
    if (!raw) {
        return "unknown";
    }
    if (raw.startsWith("feishu:")) {
        return "feishu";
    }
    if (raw.startsWith("telegram:")) {
        return "telegram";
    }
    if (raw.startsWith("discord:")) {
        return "discord";
    }
    return "imessage";
}

function normalizeSessionChatId(chatId: string, channel: SessionChannel): string {
    const raw = chatId.trim();
    if (!raw) {
        return "missing-chat";
    }
    if (channel === "imessage") {
        return normalizeChatId(raw);
    }
    return raw;
}

function shortHash(input: string): string {
    return createHash("sha1").update(input).digest("hex").slice(0, 10);
}

function sanitizeToken(input: string): string {
    return input
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

function buildChatToken(normalizedChatId: string): string {
    const safe = sanitizeToken(normalizedChatId);
    const hint = safe ? safe.slice(-12) : "chat";
    return `${hint}-${shortHash(normalizedChatId)}`;
}

function buildWorkspaceToken(workspacePath: string): string {
    const safeBase = sanitizeToken(path.basename(workspacePath)) || "workspace";
    return `${safeBase}-${shortHash(workspacePath)}`;
}

export function resolveSession(input: ResolveSessionInput): ResolvedSession {
    const channel = resolveSessionChannel(input.chatId);
    const route = input.workspacePath ? null : safeGetRouteByChatId(input.chatId);
    const workspacePath = input.workspacePath ?? route?.workspacePath;
    const normalizedChatId = normalizeSessionChatId(
        route?.chatGuid ?? input.chatId ?? `${input.source}-missing-chat`,
        channel
    );
    const chatToken = buildChatToken(normalizedChatId);
    const scopeToken = workspacePath ? `ws-${buildWorkspaceToken(workspacePath)}` : "orphan";

    return {
        sessionKey: `session:v1:${channel}:${chatToken}:${scopeToken}`,
        channel,
        normalizedChatId,
        workspacePath,
    };
}

function safeGetRouteByChatId(chatId?: string) {
    if (!chatId) {
        return null;
    }
    try {
        return getRouteByChatId(chatId);
    } catch {
        return null;
    }
}
