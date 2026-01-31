/**
 * msgcode: LM Studio CLI 适配器
 *
 * 目标：
 * - 使用本地 LM Studio API 作为 bot（不涉及 API key）
 * - 只输出最终回答，尽量过滤推理/思考过程与 ANSI/Markdown 杂质
 */

import { config } from "./config.js";

export interface LmStudioChatOptions {
    prompt: string;
    system?: string;
}

/**
 * 调用 LM Studio OpenAI 兼容 API，并返回清洗后的纯文本
 */
export async function runLmStudioChat(options: LmStudioChatOptions): Promise<string> {
    const system = options.system ?? config.lmstudioSystemPrompt;
    const baseUrl = (config.lmstudioBaseUrl || "http://127.0.0.1:1234").replace(/\/+$/, "");
    const model = (config.lmstudioModel || "").trim() || undefined;
    const timeoutMs = typeof config.lmstudioTimeoutMs === "number" && !Number.isNaN(config.lmstudioTimeoutMs)
        ? config.lmstudioTimeoutMs
        : 60_000;

    const url = `${baseUrl}/v1/chat/completions`;

    const messages: Array<{ role: "system" | "user"; content: string }> = [];
    if (system && system.trim()) {
        // 默认不注入（除非用户显式配置），避免绑定角色/行为
        messages.push({ role: "system", content: system.trim() });
    }
    messages.push({ role: "user", content: options.prompt });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const headers: Record<string, string> = { "content-type": "application/json" };
    const apiKey = config.lmstudioApiKey?.trim();
    if (apiKey) {
        headers["authorization"] = `Bearer ${apiKey}`;
    }

    let resp: Response;
    try {
        resp = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify({
                model,
                messages,
                stream: false,
            }),
            signal: controller.signal,
        });
    } catch (error: any) {
        if (error?.name === "AbortError") {
            throw new Error("LM Studio API 请求超时");
        }
        throw new Error(`LM Studio API 连接失败：请确认已在 LM Studio 中启动本地 Server（${baseUrl}）`);
    } finally {
        clearTimeout(timeoutId);
    }

    const rawText = await resp.text();
    if (!resp.ok) {
        throw new Error(`LM Studio API 错误 (${resp.status})：${sanitizeLmStudioOutput(rawText).slice(0, 400)}`);
    }

    let json: any;
    try {
        json = JSON.parse(rawText);
    } catch {
        throw new Error(`LM Studio API 返回非 JSON：${sanitizeLmStudioOutput(rawText).slice(0, 400)}`);
    }

    // OpenAI 兼容结构：choices[0].message.content
    const content = json?.choices?.[0]?.message?.content;
    const text = typeof content === "string" ? content : (content ? String(content) : "");

    // 若服务端提供 reasoning_content，也明确忽略（只转发 content）
    return sanitizeLmStudioOutput(text);
}

/**
 * 清洗 LM Studio 输出：
 * - 移除 ANSI 控制码
 * - 去除 <think>...</think>
 * - 尽量剪掉“分析/推理”段，保留最终回答
 * - 简单移除常见 Markdown 噪声
 */
export function sanitizeLmStudioOutput(text: string): string {
    let out = text ?? "";

    // 1) ANSI/VT100
    out = stripAnsi(out);

    // 2) 如果出现 </think>，直接丢弃其之前的所有内容（取最后一个 closing tag 之后）
    // 目标：不和模型“思考”内容纠缠，只保留最终回答区
    out = dropBeforeLastClosingTag(out, "think");

    // 3) <think>...</think>
    out = out.replace(/<think>[\s\S]*?<\/think>/gi, "");

    // 4) 常见“最终输出”锚点：取最后一次出现后的内容
    out = takeAfterLast(out, [
        "最终输出生成：",
        "最终输出：",
        "最终答案：",
        "最终回答：",
        "Final Answer:",
        "Final answer:",
    ]);

    // 5) 如果仍然疑似带“步骤化思考”，尝试剪掉前置“分析”段
    if (looksLikeThinking(out)) {
        out = dropThinkingPreamble(out);
    }

    // 6) 去掉“角色扮演脚手架”（action/expression/dialogue）
    out = stripRoleplayScaffolding(out);

    // 7) 简单去 Markdown（不追求完美，只做减噪）
    out = stripMarkdown(out);

    // 8) 收口
    out = out
        .split("\n")
        .map(line => line.trimEnd())
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

    return out;
}

function dropBeforeLastClosingTag(input: string, tagName: string): string {
    const lower = input.toLowerCase();
    const needle = `</${tagName.toLowerCase()}>`;
    const idx = lower.lastIndexOf(needle);
    if (idx < 0) return input;
    return input.slice(idx + needle.length);
}

function stripRoleplayScaffolding(input: string): string {
    const lines = input.split("\n");

    let hasDialogue = false;
    const out: string[] = [];

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;

        // 常见字段：action/expression/dialogue（不区分大小写）
        const m = line.match(/^(action|expression|dialogue)\s*:\s*(.*)$/i);
        if (m) {
            const key = m[1].toLowerCase();
            const value = (m[2] ?? "").trim();

            if (key === "dialogue") {
                hasDialogue = true;
                if (value) out.push(value);
            }
            // action/expression 直接丢弃
            continue;
        }

        out.push(rawLine);
    }

    // 如果识别到 dialogue 字段，则只返回 dialogue 内容（避免把 action/expression 混进来）
    if (hasDialogue) {
        return out.join("\n").trim();
    }

    return input;
}

function stripAnsi(input: string): string {
    // CSI + OSC + 少量兜底
    return input
        .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
        .replace(/\u001b\][^\u0007]*\u0007/g, "")
        .replace(/\u001b[\(\)][0-9A-Za-z]/g, "");
}

function takeAfterLast(input: string, needles: string[]): string {
    let lastIndex = -1;
    let lastNeedle = "";
    for (const needle of needles) {
        const idx = input.lastIndexOf(needle);
        if (idx > lastIndex) {
            lastIndex = idx;
            lastNeedle = needle;
        }
    }
    if (lastIndex < 0) return input;
    return input.slice(lastIndex + lastNeedle.length);
}

function looksLikeThinking(input: string): boolean {
    const sample = input.slice(0, 800);
    return (
        /思考过程|推理|分析用户|识别意图|最终输出|起草回复|内心独白/i.test(sample) ||
        /^\s*\d+\.\s*(\*\*|分析|识别|构思)/m.test(sample)
    );
}

function dropThinkingPreamble(input: string): string {
    // 典型模式：前面是一堆编号步骤，后面是一段“真正的回答”
    // 规则：找到第一段连续的“非步骤段落”（不以数字+点开头）作为起点
    const lines = input.split("\n");
    let start = 0;
    let seenStep = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const isStep = /^\d+\.\s+/.test(line) || /^\*\s+/.test(line);
        if (isStep) {
            seenStep = true;
            continue;
        }
        if (seenStep) {
            start = i;
            break;
        }
    }

    const trimmed = lines.slice(start).join("\n");
    return trimmed;
}

function stripMarkdown(input: string): string {
    return input
        .replace(/^#{1,6}\s+/gm, "")
        .replace(/\*\*(.*?)\*\*/g, "$1")
        .replace(/__(.*?)__/g, "$1")
        .replace(/`{1,3}([^`]+)`{1,3}/g, "$1")
        .replace(/^\s*[-*+]\s+/gm, "")
        .replace(/^\s*\d+\.\s+/gm, "");
}
