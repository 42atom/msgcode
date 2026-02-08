/**
 * msgcode: 远程沟通提示（手机端）
 *
 * 目标：
 * - 当用户通过 iMessage（手机端）远程驱动 Codex/Claude Code 时，
 *   让模型默认用“短、可复制、少交互”的方式回复。
 * - 提示只在“每个 tmux 会话的首次发送”注入一次。
 * - 当 tmux 会话被 kill+start（/clear）后，需要允许再次注入。
 */
const injectedRemoteHintSessions = new Set<string>();

function isRemoteHintEnabled(): boolean {
    // 默认开启；设为 0/false/off/no 可关闭
    const raw = process.env.MSGCODE_REMOTE_HINT;
    if (!raw) return true;
    return !["0", "false", "off", "no"].includes(raw.trim().toLowerCase());
}

function getRemoteHintText(): string {
    const custom = process.env.MSGCODE_REMOTE_HINT_TEXT;
    if (custom && custom.trim().length > 0) return custom.trim();

    // NOTE: 这段会作为“用户消息前缀”注入给 Codex/Claude Code，
    //       目的是让模型用更适配手机端的方式回答，不需要在回复中复述。
    return [
        "【远程上下文｜勿复述】用户在手机端通过 iMessage 远程沟通（屏幕小/复制不便）。",
        "请：1) 回复尽量短、分点；2) 命令可直接复制；3) 需要信息时一次问全；4) 避免要求频繁交互确认。",
    ].join("\n");
}

export function withRemoteHintIfNeeded(sessionName: string, message: string): string {
    if (!isRemoteHintEnabled()) return message;

    if (injectedRemoteHintSessions.has(sessionName)) return message;
    injectedRemoteHintSessions.add(sessionName);

    const hint = getRemoteHintText();
    if (!hint) return message;

    return `${hint}\n\n${message}`;
}

export function resetRemoteHintForSession(sessionName: string): void {
    injectedRemoteHintSessions.delete(sessionName);
}

export function __resetRemoteHintForTests(): void {
    injectedRemoteHintSessions.clear();
}

