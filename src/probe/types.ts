/**
 * msgcode: 可观测性探针类型定义
 *
 * E15: 统一的健康检查与状态探针
 */

/**
 * 单个探针结果
 */
export interface ProbeResult {
    /** 探针名称 */
    name: string;
    /** 探针状态 */
    status: ProbeStatus;
    /** 状态描述 */
    message: string;
    /** 详细信息（禁止输出敏感内容：.env 值、用户消息等） */
    details?: Record<string, unknown>;
}

/**
 * 探针状态
 */
export type ProbeStatus = "pass" | "warning" | "error" | "skip";

/**
 * 探针类别结果
 */
export interface ProbeCategoryResult {
    /** 类别名称 */
    name: string;
    /** 类别状态（由 probes 聚合） */
    status: ProbeStatus;
    /** 该类别下的所有探针 */
    probes: ProbeResult[];
}

/**
 * 状态报告摘要
 */
export interface StatusSummary {
    /** 总体状态 */
    status: ProbeStatus;
    /** 警告数量 */
    warnings: number;
    /** 错误数量 */
    errors: number;
}

/**
 * 完整状态报告
 */
export interface StatusReport {
    /** 报告版本 */
    version: string;
    /** 时间戳 */
    timestamp: string;
    /** 摘要 */
    summary: StatusSummary;
    /** 各类别探针结果 */
    categories: Record<string, ProbeCategoryResult>;
}

/**
 * 探针执行选项
 */
export interface ProbeOptions {
    /** 超时时间（毫秒），默认 2000 */
    timeout?: number;
}

/**
 * 格式化选项
 */
export interface FormatOptions {
    /** 输出格式 */
    format: "text" | "json";
    /** 是否彩色输出（仅 text 格式） */
    colorize?: boolean;
}

/**
 * 探针函数签名
 */
export type ProbeFunction = (options?: ProbeOptions) => Promise<ProbeResult>;

/**
 * 带超时的 Promise 执行
 */
export async function withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    description: string
): Promise<T> {
    let timeoutHandle: NodeJS.Timeout | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
            reject(new Error(`超时 (${timeoutMs}ms): ${description}`));
        }, timeoutMs);
    });

    try {
        return await Promise.race([promise, timeoutPromise]);
    } finally {
        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
        }
    }
}

/**
 * 安全地执行探针（捕获异常，不影响其他探针）
 */
export async function safeProbe(
    name: string,
    fn: () => Promise<ProbeResult>
): Promise<ProbeResult> {
    try {
        return await fn();
    } catch (error) {
        return {
            name,
            status: "error",
            message: `探针执行异常: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}

/**
 * 聚合探针状态
 */
export function aggregateStatus(results: ProbeResult[]): ProbeStatus {
    if (results.some(r => r.status === "error")) return "error";
    if (results.some(r => r.status === "warning")) return "warning";
    if (results.some(r => r.status === "pass")) return "pass";
    return "skip";
}
