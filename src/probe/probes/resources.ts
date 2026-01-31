/**
 * msgcode: 资源探针
 *
 * 检查磁盘空间、内存使用、日志大小
 */

import { promises as fs } from "node:fs";
import { execSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import type { ProbeResult, ProbeOptions } from "../types.js";

/**
 * 资源探针
 */
export async function probeResources(options?: ProbeOptions): Promise<ProbeResult> {
    const details: Record<string, unknown> = {};
    const issues: string[] = [];
    let diskFreeGb: number | undefined;

    // 1. 磁盘空间
    const homeDir = os.homedir();
    try {
        const dfOutput = execSync(`df -h "${homeDir}"`, { encoding: "utf8", timeout: 2000 });
        const lines = dfOutput.split("\n");
        if (lines.length >= 2) {
            const parts = lines[1].split(/\s+/);
            const available = parts[3];
            const capacity = parts[4];
            details.disk_available = available;
            details.disk_capacity = capacity;

            const availableMatch = available.match(/([\d.]+)(G|M)/i);
            if (availableMatch) {
                const value = parseFloat(availableMatch[1]);
                const unit = availableMatch[2].toUpperCase();
                const availableGB = unit === "M" ? value / 1024 : value;
                diskFreeGb = Math.round(availableGB * 10) / 10;
                details.disk_free_gb = diskFreeGb;

                if (availableGB < 5) {
                    issues.push(`磁盘空间不足 (${available})`);
                }
            }
        }
    } catch {
        // 无法获取磁盘信息，跳过
    }

    // 2. 内存使用
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    details.memory_total_mb = Math.round(totalMem / 1024 / 1024);
    details.memory_used_mb = Math.round(usedMem / 1024 / 1024);
    details.memory_free_mb = Math.round(freeMem / 1024 / 1024);

    // 3. 日志文件大小
    const logPath = path.join(os.homedir(), ".config/msgcode/log/msgcode.log");
    try {
        const stats = await fs.stat(logPath);
        details.log_size_mb = Math.round(stats.size / 1024 / 1024 * 100) / 100;

        if (stats.size > 100 * 1024 * 1024) {
            issues.push(`日志文件过大 (${details.log_size_mb} MB)`);
        }
    } catch {
        details.log_exists = false;
    }

    // 4. CPU 核心数
    details.cpu_count = os.cpus().length;

    // 判断状态
    let status: ProbeResult["status"] = "pass";
    if (typeof diskFreeGb === "number" && diskFreeGb < 2) {
        status = "error";
    } else if (issues.length > 0) {
        status = "warning";
    }

    return {
        name: "resources",
        status,
        message: issues.length > 0 ? issues.join("; ") : "资源检查通过",
        details,
    };
}
