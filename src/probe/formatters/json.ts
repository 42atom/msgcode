/**
 * msgcode: JSON 格式化器
 *
 * 输出 Envelope 格式（对齐 CLI Contract v2.1）
 */

import type { StatusReport } from "../types.js";
import type { Envelope, Diagnostic } from "../../memory/types.js";
import { randomUUID } from "node:crypto";

/**
 * 将 StatusReport 转换为 Diagnostic 列表
 */
function reportToDiagnostics(report: StatusReport): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    for (const [key, category] of Object.entries(report.categories)) {
        for (const probe of category.probes) {
            if (probe.status !== "pass") {
                diagnostics.push({
                    code: `PROBE_${key.toUpperCase()}_${probe.status.toUpperCase()}`,
                    message: probe.message || `${category.name}: ${probe.status}`,
                    hint: probe.fixHint,
                });
            }
        }
    }

    return diagnostics;
}

/**
 * 格式化为 Envelope（JSON）
 */
export function formatJson(report: StatusReport, command: string, startTime: number): string {
    const warnings: Diagnostic[] = [];
    const errors: Diagnostic[] = [];

    for (const diag of reportToDiagnostics(report)) {
        if (diag.code.includes("_WARNING_")) {
            warnings.push(diag);
        } else {
            errors.push(diag);
        }
    }

    const status = report.summary.status === "error" ? "error"
        : report.summary.status === "warning" ? "warning"
        : "pass" as const;

    const exitCode = status === "error" ? 1 : status === "warning" ? 2 : 0;
    const durationMs = Date.now() - startTime;

    const envelope: Envelope<StatusReport> = {
        schemaVersion: 2,
        command,
        requestId: randomUUID(),
        timestamp: new Date().toISOString(),
        durationMs,
        status,
        exitCode,
        summary: {
            warnings: report.summary.warnings,
            errors: report.summary.errors,
        },
        data: report,
        warnings,
        errors,
    };

    return JSON.stringify(envelope, null, 2);
}
