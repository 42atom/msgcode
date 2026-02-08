/**
 * msgcode: 可观测性探针主入口
 *
 * E15: 统一的健康检查与状态探针
 */

import {
    probeEnvironment,
    probePermissions,
    probeConfig,
    probeRoutes,
    probeConnections,
    probeResources,
} from "./probes/index.js";
import { probeJobs } from "./probes/jobs.js";
import { probeDeps } from "./probes/deps.js";
import { probeCodex } from "./probes/runner.js";
import { probeTts } from "./probes/tts.js";
import { probeInbound } from "./probes/inbound.js";
import { formatJson } from "./formatters/json.js";
import { formatText } from "./formatters/text.js";
import { safeProbe, aggregateStatus } from "./types.js";
import type { StatusReport, ProbeOptions, FormatOptions } from "./types.js";

/**
 * 探针类别定义
 */
const PROBE_CATEGORIES = [
    { name: "环境", key: "environment", probe: probeEnvironment },
    { name: "权限", key: "permissions", probe: probePermissions },
    { name: "配置", key: "config", probe: probeConfig },
    { name: "路由", key: "routes", probe: probeRoutes },
    { name: "连接", key: "connections", probe: probeConnections },
    { name: "资源", key: "resources", probe: probeResources },
    { name: "任务", key: "jobs", probe: probeJobs },
    { name: "依赖", key: "deps", probe: probeDeps },
    { name: "语音", key: "tts", probe: probeTts },
    { name: "执行臂", key: "runner", probe: probeCodex },
    { name: "入站", key: "inbound", probe: probeInbound },
] as const;

/**
 * 运行所有探针，生成完整状态报告
 */
export async function runAllProbes(options?: ProbeOptions): Promise<StatusReport> {
    const timestamp = new Date().toISOString();
    const categories: StatusReport["categories"] = {};
    let totalWarnings = 0;
    let totalErrors = 0;

    // 按顺序执行探针
    for (const categoryDef of PROBE_CATEGORIES) {
        const result = await safeProbe(categoryDef.key, async () => {
            const timeout = options?.timeout ?? (
                categoryDef.key === "connections" ? 2000 : 5000
            );
            return await categoryDef.probe({ timeout });
        });

        // 构建类别结果
        const categoryResult = {
            name: categoryDef.name,
            status: result.status,
            probes: [result],
        };

        categories[categoryDef.key] = categoryResult;

        if (result.status === "warning") totalWarnings++;
        if (result.status === "error") totalErrors++;
    }

    // 聚合总体状态
    const overallStatus = aggregateStatus(
        Object.values(categories).flatMap(c => c.probes)
    );

    return {
        version: "1.0",
        timestamp,
        summary: {
            status: overallStatus,
            warnings: totalWarnings,
            errors: totalErrors,
        },
        categories,
    };
}

/**
 * 运行单个类别的探针
 */
export async function runSingleProbe(
    category: string,
    options?: ProbeOptions
): Promise<StatusReport> {
    const timestamp = new Date().toISOString();
    const categories: StatusReport["categories"] = {};
    let warnings = 0;
    let errors = 0;

    const categoryDef = PROBE_CATEGORIES.find(c => c.key === category);
    if (!categoryDef) {
        throw new Error(`未知的探针类别: ${category}`);
    }

    const result = await safeProbe(categoryDef.key, async () => {
        const timeout = options?.timeout ?? (
            category === "connections" ? 2000 : 5000
        );
        return await categoryDef.probe({ timeout });
    });

    categories[category] = {
        name: categoryDef.name,
        status: result.status,
        probes: [result],
    };

    if (result.status === "warning") warnings++;
    if (result.status === "error") errors++;

    return {
        version: "1.0",
        timestamp,
        summary: {
            status: result.status,
            warnings,
            errors,
        },
        categories,
    };
}

/**
 * 格式化状态报告
 */
export function formatReport(report: StatusReport, options: FormatOptions, command?: string, startTime?: number): string {
    if (options.format === "json") {
        return formatJson(report, command ?? "msgcode status", startTime ?? Date.now());
    }
    return formatText(report);
}
