/**
 * msgcode: 文本格式化器
 */

import type { StatusReport, ProbeResult, ProbeStatus } from "../types.js";

/**
 * 状态符号映射
 */
const STATUS_SYMBOLS: Record<ProbeStatus, string> = {
    pass: "✅",
    warning: "⚠️ ",
    error: "❌",
    skip: "⊘",
};

/**
 * 格式化为文本
 */
export function formatText(report: StatusReport): string {
    const lines: string[] = [];

    lines.push("msgcode 2.0 状态报告");
    lines.push("=".repeat(40));
    lines.push("");

    // 输出各类别
    for (const [key, category] of Object.entries(report.categories)) {
        const symbol = STATUS_SYMBOLS[category.status];
        lines.push(`${category.name}: ${symbol} ${getStatusText(category.status)}`);

        // 输出探针详情
        for (const probe of category.probes) {
            formatProbe(lines, probe, "  ");
        }

        lines.push("");
    }

    // 输出总结
    const summary = report.summary;
    const summarySymbol = STATUS_SYMBOLS[summary.status];
    lines.push("=".repeat(40));
    lines.push(`总结: ${summary.errors} 错误，${summary.warnings} 警告`);
    lines.push(`状态: ${summarySymbol} ${getStatusText(summary.status)}`);

    return lines.join("\n");
}

/**
 * 格式化单个探针
 */
function formatProbe(lines: string[], probe: ProbeResult, indent: string): void {
    const symbol = STATUS_SYMBOLS[probe.status];

    // 输出探针名称和状态
    lines.push(`${indent}${symbol} ${probe.message}`);

    // 输出详情
    if (probe.details && Object.keys(probe.details).length > 0) {
        // E15 补丁：路由探针特殊处理（隐藏敏感路径）
        const displayDetails = probe.name === "routes"
            ? formatRouteDetails(probe.details)
            : probe.details;

        for (const [key, value] of Object.entries(displayDetails)) {
            lines.push(`${indent}  ${key}: ${formatValue(value, key, displayDetails)}`);
        }
    }
}

/**
 * 格式化值
 */
function formatValue(value: unknown, key?: string, context?: Record<string, unknown>): string {
    if (value === true) return "✓";
    if (value === false) return "✗";
    if (value === null || value === undefined) return "—";
    if (typeof value === "number") return String(value);
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return `(${value.length})`;
    return String(value);
}

/**
 * E15 补丁：格式化路由详情（隐藏敏感路径）
 */
function formatRouteDetails(details: Record<string, unknown>): Record<string, unknown> {
    const formatted: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(details)) {
        if (key === "routes" && Array.isArray(value)) {
            // 路由列表：只显示 label + exists，隐藏完整路径
            formatted[key] = value.map((route: unknown) => {
                if (typeof route === "object" && route !== null) {
                    const r = route as Record<string, unknown>;
                    return {
                        label: r.label,
                        exists: r.workspace_exists,
                        tmux: r.tmux_running,
                        last_activity: r.last_activity_minutes_ago,
                    };
                }
                return route;
            });
        } else {
            formatted[key] = value;
        }
    }

    return formatted;
}

/**
 * 获取状态文本
 */
function getStatusText(status: ProbeStatus): string {
    switch (status) {
        case "pass":
            return "通过";
        case "warning":
            return "警告";
        case "error":
            return "错误";
        case "skip":
            return "跳过";
    }
}
