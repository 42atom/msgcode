/**
 * msgcode: 输出清洗器
 *
 * 职责：
 * - 空输出判定
 * - 脏前缀清洗（元叙事、ANSI）
 * - 只读提示去除
 * - 可展示文本标准化
 */

// ============================================
// 核心清洗函数
// ============================================

/**
 * 清洗 LM Studio 输出
 *
 * 流程：
 * 1. 移除 ANSI 转义码
 * 2. 移除元叙事前缀
 * 3. 去除只读提示
 * 4. 去重噪声行
 * 5. 标准化 JSON 片段
 *
 * @param text 原始输出
 * @returns 清洗后的文本
 */
export function sanitizeLmStudioOutput(text: string): string {
    if (!text) return text;

    // 1. 移除 ANSI 转义码
    let cleaned = stripAnsi(text);

    // 2. 移除元叙事前缀
    cleaned = stripMetaNarrative(cleaned);

    // 3. 移除只读提示
    cleaned = stripReadOnlyHint(cleaned);

    // 4. 标准化 JSON 片段
    cleaned = normalizeJsonishEnvelope(cleaned);

    // 5. 去重噪声行
    cleaned = dedupeNoisyLines(cleaned.split("\n")).join("\n");

    return cleaned.trim();
}

/**
 * 判断输出是否为空（不可展示）
 */
export function isEmptyOutput(text: string): boolean {
    const cleaned = sanitizeLmStudioOutput(text);
    // 空字符串或纯空白
    if (!cleaned.trim()) return true;

    // 常见模型"已读不回"噪声
    const noisePatterns = [
        /^(?:嗯|好的|收到|了解|明白|OK|ok|okay)\s*$/i,
        /^(?:I understand|I see|Understood)\s*$/i,
    ];
    if (noisePatterns.some(p => p.test(cleaned))) return true;

    return false;
}

// ============================================
// 内部实现
// ============================================

/**
 * 移除 ANSI 转义码
 */
export function stripAnsi(input: string): string {
    return input
        .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
        .replace(/\u001b\][^\u0007]*\u0007/g, "")
        .replace(/\u001b[\(\)][0-9A-Za-z]/g, "");
}

/**
 * 移除元叙事前缀
 *
 * 识别并去除模型输出的"元叙事"前缀（如"用户上传了..."、"我需要分析..."）
 */
export function stripMetaNarrative(input: string): string {
    const raw = input.trim();
    if (!raw) return raw;

    const metaKeywords = [
        "用户上传",
        "用户发",
        "我需要",
        "我必须",
        "我的角色",
        "系统指令",
        "输入包含",
        "根据输入",
        "约束",
        "分析",
        "计划",
        "两段式",
        "第1段",
        "第2段",
        "[图片文字]",
        "[图片错误]",
        "[attachment]",
        "[derived]",
        "tool_calls",
        "filesystem",
        "mcp",
    ];

    const looksMeta = metaKeywords.some(k => raw.toLowerCase().includes(k.toLowerCase()));
    if (!looksMeta) return raw;

    // 句子级过滤：尽量保留"像答案"的句子
    const sentences = raw
        .split(/(?<=[。！？\n])/)
        .map(s => s.trim())
        .filter(Boolean);

    const kept: string[] = [];
    let total = 0;
    for (const s of sentences) {
        if (metaKeywords.some(k => s.toLowerCase().includes(k.toLowerCase()))) continue;
        kept.push(s);
        total += s.length;
        if (total >= 360) break;
    }

    if (kept.length > 0) {
        return kept.join("").trim();
    }

    // 兜底：若完全过滤空了，保留最前面的短片段
    return raw.slice(0, 360).trim();
}

/**
 * 移除只读提示
 */
function stripReadOnlyHint(input: string): string {
    // 移除常见的只读提示
    const patterns = [
        /^\[只读信息\].*/gm,
        /^\[系统消息\].*/gm,
        /^\[只读\].*/gm,
    ];

    let cleaned = input;
    for (const pattern of patterns) {
        cleaned = cleaned.replace(pattern, "");
    }
    return cleaned;
}

/**
 * 去重噪声行
 *
 * 连续重复行直接去掉，高频重复行最多保留 2 次
 */
export function dedupeNoisyLines(lines: string[]): string[] {
    const out: string[] = [];
    const seenCounts = new Map<string, number>();

    let last = "";
    for (const raw of lines) {
        const line = raw.trimEnd();
        if (!line) {
            out.push(line);
            last = line;
            continue;
        }

        // 连续重复行直接去掉
        if (line === last) {
            continue;
        }

        // 高频重复行（例如 OCR 噪声/模型循环）最多保留 2 次
        const key = line.length > 120 ? line.slice(0, 120) : line;
        const n = (seenCounts.get(key) ?? 0) + 1;
        seenCounts.set(key, n);
        if (n > 2) {
            continue;
        }

        out.push(line);
        last = line;
    }

    // 收口：末尾空行过多会影响 iMessage 展示
    while (out.length > 0 && out[out.length - 1] === "") {
        out.pop();
    }
    return out;
}

/**
 * 标准化 JSON 片段
 *
 * 处理模型输出的 JSON 片段（换行转义、格式规范化等）
 */
export function normalizeJsonishEnvelope(input: string): string {
    let out = input;

    // 有些模型会把换行以 "\\n" 的形式塞进字符串里
    if (out.includes("\\n")) {
        out = out.replace(/\\\\n/g, "\n");
        out = out.replace(/\\n/g, "\n");
    }

    const lines = out.split("\n");
    const normalized: string[] = [];

    for (let rawLine of lines) {
        const trimmed = rawLine.trim();

        // 直接丢弃 reasoning_content 行（无论是 JSON key 还是类 key:value）
        if (/^"?reasoning_content"?\s*:/.test(trimmed)) {
            continue;
        }
        if (/^reasoning_content\s*=/i.test(trimmed)) {
            continue;
        }

        // 丢弃 role 行（有些模型会输出 role/content/reasoning_content 的 JSON 片段）
        if (/^"?role"?\s*:/.test(trimmed)) {
            continue;
        }

        // 若是 "content": "..." 这种包裹，把前缀剥掉，让后续规则能识别 Action/Expression/Dialogue
        rawLine = rawLine.replace(/^\s*"?content"?\s*:\s*"/, "");
        // 去掉行尾可能出现的引号/逗号
        rawLine = rawLine.replace(/"\s*,?\s*$/, "");

        normalized.push(rawLine);
    }

    return normalized.join("\n");
}

/**
 * 删除指定标签之前的内容
 *
 * 例如：删除最后一个 `</invoke>` 之前的内容
 */
export function dropBeforeLastClosingTag(input: string, tagName: string): string {
    const lower = input.toLowerCase();
    const needle = `</${tagName.toLowerCase()}>`;
    const idx = lower.lastIndexOf(needle);
    if (idx < 0) return input;
    return input.slice(idx + needle.length);
}
