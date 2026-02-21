/**
 * Tool Loop SLO 连续流量统计脚本
 *
 * P5.7-R3k: 从 msgcode.log 解析连续流量数据，计算 SLO 指标
 *
 * 指标定义：
 * - R1: 工具命中率 = R1_toolcall_hit / 需要工具请求总数
 * - R2: 可展示率 = R2_非空可展示 / 已执行工具请求总数
 * - E2E: 端到端成功率 = 成功请求数 / 全量请求总数
 *
 * 日志字段：
 * - route: 路由类型 (tool|complex-tool|no-tool)
 * - toolCallCount: 工具调用次数
 * - toolName: 工具名称
 * - responseText: 回复内容
 * - error: 错误信息
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ============================================
// 类型定义
// ============================================

interface LogEntry {
    timestamp: string;
    level: string;
    message: string;
    chatId?: string;
    route?: string;
    toolCallCount?: number;
    toolName?: string;
    responseText?: string;
    error?: string;
    errorCode?: string;
    soulInjected?: boolean;
    memoryInjected?: boolean;
}

interface SLOMetrics {
    // R1 指标
    r1Total: number; // 需要工具请求总数
    r1Hit: number; // R1 结构化 tool_calls 成功数
    r1Rate: string;

    // R2 指标
    r2Total: number; // 已执行工具请求总数
    r2Displayable: number; // R2 非空可展示数
    r2Rate: string;

    // E2E 指标
    e2eTotal: number; // 全量请求总数
    e2eSuccess: number; // 成功请求数
    e2eRate: string;

    // 辅助指标
    toolExecTotal: number; // 工具调用总数
    toolExecSuccess: number; // 工具执行成功数
    toolExecRate: string;

    emptyResponseCount: number; // 清洗后空答复数
    driftCount: number; // 二轮漂移数
}

interface SLOResult {
    status: "PASS" | "WARN" | "FAIL";
    metrics: SLOMetrics;
    period: {
        start: string;
        end: string;
    };
    thresholdBreaches: string[];
    recommendations: string[];
}

// ============================================
// 阈值配置（P5.7-R3k 冻结）
// ============================================

const THRESHOLDS = {
    R1: { target: 98, warn: 95 },
    R2: { target: 97, warn: 94 },
    E2E: { target: 95, warn: 92 },
    TOOL_EXEC: { target: 97, warn: 93 },
    EMPTY_RESPONSE: { max: 1 },
    DRIFT: { max: 2 },
};

// ============================================
// 日志解析
// ============================================

/**
 * 解析单行日志
 */
function parseLogLine(line: string): LogEntry | null {
    // 日志格式：2026-02-21T10:00:00.000Z [INFO ] [module] message [meta...]
    const match = line.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)\s+\[(\w+)\]\s+(?:\[([^\]]+)\]\s+)?(.+)$/);
    if (!match) return null;

    const [, timestamp, level, module, message] = match;

    const entry: LogEntry = {
        timestamp,
        level,
        message,
    };

    // 提取元数据字段
    const metaMatch = message.match(/\[(.+)\]$/);
    if (metaMatch) {
        const metaStr = metaMatch[1];
        const metaPairs = metaStr.split(/\s+/);

        for (const pair of metaPairs) {
            const [key, ...valueParts] = pair.split("=");
            const value = valueParts.join("=").replace(/^"|"$/g, "");

            switch (key) {
                case "chatId":
                    entry.chatId = value;
                    break;
                case "route":
                    entry.route = value;
                    break;
                case "toolCallCount":
                    entry.toolCallCount = parseInt(value, 10);
                    break;
                case "toolName":
                    entry.toolName = value;
                    break;
                case "responseText":
                    entry.responseText = value;
                    break;
                case "error":
                    entry.error = value;
                    break;
                case "errorCode":
                    entry.errorCode = value;
                    break;
                case "soulInjected":
                    entry.soulInjected = value === "true";
                    break;
                case "memoryInjected":
                    entry.memoryInjected = value === "true";
                    break;
            }
        }
    }

    return entry;
}

/**
 * 读取日志文件
 */
function readLogFile(logPath: string): LogEntry[] {
    if (!fs.existsSync(logPath)) {
        console.warn(`日志文件不存在：${logPath}`);
        return [];
    }

    const content = fs.readFileSync(logPath, "utf-8");
    const lines = content.split("\n").filter((line) => line.trim().length > 0);
    const entries: LogEntry[] = [];

    for (const line of lines) {
        const entry = parseLogLine(line);
        if (entry) {
            entries.push(entry);
        }
    }

    return entries;
}

// ============================================
// SLO 指标计算
// ============================================

/**
 * 计算 SLO 指标
 *
 * 口径说明：
 * - 需要工具请求：route in {"tool", "complex-tool"}
 * - R1 命中：route in {"tool", "complex-tool"} 且 toolCallCount >= 1
 * - 已执行工具请求：toolCallCount >= 1
 * - R2 可展示：有 responseText 且非空
 * - E2E 成功：有 responseText 且无 error
 */
function calculateSLO(entries: LogEntry[]): SLOResult {
    const metrics: SLOMetrics = {
        r1Total: 0,
        r1Hit: 0,
        r1Rate: "0%",
        r2Total: 0,
        r2Displayable: 0,
        r2Rate: "0%",
        e2eTotal: 0,
        e2eSuccess: 0,
        e2eRate: "0%",
        toolExecTotal: 0,
        toolExecSuccess: 0,
        toolExecRate: "0%",
        emptyResponseCount: 0,
        driftCount: 0,
    };

    let startTime = "";
    let endTime = "";

    for (const entry of entries) {
        // 时间范围
        if (entry.timestamp) {
            if (!startTime || entry.timestamp < startTime) startTime = entry.timestamp;
            if (!endTime || entry.timestamp > endTime) endTime = entry.timestamp;
        }

        // 只处理 agent 请求（有 route 字段或 toolCallCount 字段）
        const isAgentRequest =
            entry.route !== undefined ||
            entry.toolCallCount !== undefined ||
            entry.message.includes("agent request");

        if (!isAgentRequest) continue;

        metrics.e2eTotal++;

        // R1: 需要工具请求
        const requiresTool = entry.route === "tool" || entry.route === "complex-tool";
        if (requiresTool) {
            metrics.r1Total++;

            // R1 命中：有工具调用
            if ((entry.toolCallCount ?? 0) >= 1 || entry.toolName) {
                metrics.r1Hit++;
            }
        }

        // R2: 已执行工具请求
        if ((entry.toolCallCount ?? 0) >= 1 || entry.toolName) {
            metrics.toolExecTotal++;
            metrics.r2Total++;

            // R2 可展示：有 responseText 且非空
            const responseText = entry.responseText || "";
            if (responseText.trim().length > 0) {
                metrics.r2Displayable++;
            } else {
                metrics.emptyResponseCount++;
            }

            // 工具执行成功：无 error 且 ok=true（如果有）
            if (!entry.error && !entry.errorCode) {
                metrics.toolExecSuccess++;
            }
        }

        // E2E 成功：有 responseText 且无 error
        const responseText = entry.responseText || "";
        if (responseText.trim().length > 0 && !entry.error && !entry.errorCode) {
            metrics.e2eSuccess++;
        }

        // 漂移检测
        if (responseText.includes("<tool_call")) {
            metrics.driftCount++;
        }
    }

    // 计算比率
    metrics.r1Rate = metrics.r1Total > 0
        ? ((metrics.r1Hit / metrics.r1Total) * 100).toFixed(2) + "%"
        : "N/A";
    metrics.r2Rate = metrics.r2Total > 0
        ? ((metrics.r2Displayable / metrics.r2Total) * 100).toFixed(2) + "%"
        : "N/A";
    metrics.e2eRate = metrics.e2eTotal > 0
        ? ((metrics.e2eSuccess / metrics.e2eTotal) * 100).toFixed(2) + "%"
        : "N/A";
    metrics.toolExecRate = metrics.toolExecTotal > 0
        ? ((metrics.toolExecSuccess / metrics.toolExecTotal) * 100).toFixed(2) + "%"
        : "N/A";

    // 阈值检查
    const breaches: string[] = [];
    const recommendations: string[] = [];

    const r1Rate = parseFloat(metrics.r1Rate) || 0;
    const r2Rate = parseFloat(metrics.r2Rate) || 0;
    const e2eRate = parseFloat(metrics.e2eRate) || 0;
    const toolExecRate = parseFloat(metrics.toolExecRate) || 0;

    if (r1Rate < THRESHOLDS.R1.warn) {
        breaches.push(`R1 (${r1Rate}%) < 告警阈值 (${THRESHOLDS.R1.warn}%)`);
        recommendations.push("R1 命中率低于告警阈值，建议降级到安全模型或纯文本模式");
    } else if (r1Rate < THRESHOLDS.R1.target) {
        breaches.push(`R1 (${r1Rate}%) < 目标阈值 (${THRESHOLDS.R1.target}%)`);
    }

    if (r2Rate < THRESHOLDS.R2.warn) {
        breaches.push(`R2 (${r2Rate}%) < 告警阈值 (${THRESHOLDS.R2.warn}%)`);
        recommendations.push("R2 可展示率低于告警阈值，建议触发兜底回复并标记失败");
    } else if (r2Rate < THRESHOLDS.R2.target) {
        breaches.push(`R2 (${r2Rate}%) < 目标阈值 (${THRESHOLDS.R2.target}%)`);
    }

    if (e2eRate < THRESHOLDS.E2E.warn) {
        breaches.push(`E2E (${e2eRate}%) < 告警阈值 (${THRESHOLDS.E2E.warn}%)`);
        recommendations.push("E2E 成功率低于告警阈值，建议启动降级路由");
    } else if (e2eRate < THRESHOLDS.E2E.target) {
        breaches.push(`E2E (${e2eRate}%) < 目标阈值 (${THRESHOLDS.E2E.target}%)`);
    }

    if (toolExecRate < THRESHOLDS.TOOL_EXEC.warn) {
        breaches.push(`工具执行成功率 (${toolExecRate}%) < 告警阈值 (${THRESHOLDS.TOOL_EXEC.warn}%)`);
        recommendations.push("工具执行成功率低，建议按 errorCode 分类重试");
    }

    if (metrics.emptyResponseCount > THRESHOLDS.EMPTY_RESPONSE.max) {
        breaches.push(`空答复数 (${metrics.emptyResponseCount}) > 阈值 (${THRESHOLDS.EMPTY_RESPONSE.max})`);
        recommendations.push("空答复过多，建议走兜底文案并记录样本");
    }

    if (metrics.driftCount > THRESHOLDS.DRIFT.max) {
        breaches.push(`二轮漂移数 (${metrics.driftCount}) > 阈值 (${THRESHOLDS.DRIFT.max})`);
        recommendations.push("漂移过多，建议启用漂移兜底并告警");
    }

    // 状态判定
    let status: "PASS" | "WARN" | "FAIL" = "PASS";
    if (breaches.some((b) => b.includes("告警阈值"))) {
        status = "FAIL";
    } else if (breaches.length > 0) {
        status = "WARN";
    }

    return {
        status,
        metrics,
        period: { start: startTime, end: endTime },
        thresholdBreaches: breaches,
        recommendations,
    };
}

// ============================================
// 报告生成
// ============================================

function formatReport(result: SLOResult): string {
    const lines: string[] = [];

    lines.push("=".repeat(60));
    lines.push("Tool Loop SLO 连续流量统计报告");
    lines.push("=".repeat(60));
    lines.push();
    lines.push(`统计周期：${result.period.start || "N/A"} ~ ${result.period.end || "N/A"}`);
    lines.push(`门禁状态：${result.status}`);
    lines.push();

    lines.push("核心指标:");
    lines.push(`  R1 命中率：   ${result.metrics.r1Rate} (目标 >= ${THRESHOLDS.R1.target}%, 告警 < ${THRESHOLDS.R1.warn}%)`);
    lines.push(`             ${result.metrics.r1Hit}/${result.metrics.r1Total}`);
    lines.push(`  R2 可展示率： ${result.metrics.r2Rate} (目标 >= ${THRESHOLDS.R2.target}%, 告警 < ${THRESHOLDS.R2.warn}%)`);
    lines.push(`             ${result.metrics.r2Displayable}/${result.metrics.r2Total}`);
    lines.push(`  E2E 成功率： ${result.metrics.e2eRate} (目标 >= ${THRESHOLDS.E2E.target}%, 告警 < ${THRESHOLDS.E2E.warn}%)`);
    lines.push(`             ${result.metrics.e2eSuccess}/${result.metrics.e2eTotal}`);
    lines.push(`  工具执行率： ${result.metrics.toolExecRate} (目标 >= ${THRESHOLDS.TOOL_EXEC.target}%, 告警 < ${THRESHOLDS.TOOL_EXEC.warn}%)`);
    lines.push(`             ${result.metrics.toolExecSuccess}/${result.metrics.toolExecTotal}`);
    lines.push();

    lines.push("辅助指标:");
    lines.push(`  空答复数：${result.metrics.emptyResponseCount} (阈值 <= ${THRESHOLDS.EMPTY_RESPONSE.max})`);
    lines.push(`  漂移数：  ${result.metrics.driftCount} (阈值 <= ${THRESHOLDS.DRIFT.max})`);
    lines.push();

    if (result.thresholdBreaches.length > 0) {
        lines.push("阈值突破:");
        for (const breach of result.thresholdBreaches) {
            lines.push(`  - ${breach}`);
        }
        lines.push();
    }

    if (result.recommendations.length > 0) {
        lines.push("处置建议:");
        for (const rec of result.recommendations) {
            lines.push(`  - ${rec}`);
        }
        lines.push();
    }

    lines.push("=".repeat(60));

    return lines.join("\n");
}

// ============================================
// 主函数
// ============================================

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    let logPath = args[0];

    // 默认日志路径
    if (!logPath) {
        const possiblePaths = [
            path.join(process.cwd(), "msgcode.log"),
            path.join(process.cwd(), "artifacts", "logs", "msgcode.log"),
            path.join(process.env.HOME || "", ".msgcode", "msgcode.log"),
        ];

        for (const p of possiblePaths) {
            if (fs.existsSync(p)) {
                logPath = p;
                break;
            }
        }
    }

    if (!logPath) {
        console.error("未找到日志文件，请指定路径：npx tsx scripts/slo-stats.ts <log-path>");
        process.exit(1);
    }

    console.log(`读取日志文件：${logPath}`);
    const entries = readLogFile(logPath);
    console.log(`解析日志条目：${entries.length} 条`);

    if (entries.length === 0) {
        console.log("无有效日志条目，跳过统计");
        process.exit(0);
    }

    const result = calculateSLO(entries);
    const report = formatReport(result);

    console.log();
    console.log(report);

    // 保存报告
    const reportDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "AIDOCS", "reports");
    if (!fs.existsSync(reportDir)) {
        fs.mkdirSync(reportDir, { recursive: true });
    }

    const reportPath = path.join(reportDir, `slo-stats-${Date.now()}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(result, null, 2));
    console.log(`详细报告已保存：${reportPath}`);

    // 退出码
    process.exit(result.status === "PASS" ? 0 : 1);
}

// ============================================
// 入口
// ============================================

main().catch((error) => {
    console.error("执行失败:", error);
    process.exit(1);
});
