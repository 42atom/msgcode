/**
 * msgcode: JSON 格式化器
 */

import type { StatusReport, ProbeResult } from "../types.js";

/**
 * 格式化为 JSON
 */
export function formatJson(report: StatusReport): string {
    return JSON.stringify(report, null, 2);
}
