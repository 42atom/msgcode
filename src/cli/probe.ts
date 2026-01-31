/**
 * msgcode: probe 命令
 *
 * 运行系统健康检查探针
 */

import * as os from "node:os";
import * as path from "node:path";
import { runProbes, RealCommandExecutor } from "../probe/index.js";

/**
 * 获取默认配置
 */
function getProbeConfig() {
    return {
        imsgPath: process.env.IMSG_PATH,
        routesPath: path.join(os.homedir(), ".config/msgcode/routes.json"),
        workspaceRoot: process.env.WORKSPACE_ROOT || path.join(os.homedir(), "msgcode-workspaces"),
    };
}

/**
 * 格式化探针结果为纯文本
 */
function formatProbeReport(results: any[], summary: any): string {
    const lines: string[] = [];

    for (const result of results) {
        const status = result.ok ? "[OK]" : "[FAIL]";
        lines.push(`${status} ${result.name}: ${result.details}`);
        if (result.fixHint) {
            lines.push(`    Hint: ${result.fixHint}`);
        }
    }

    lines.push("");
    lines.push(`Summary: ${summary.ok} OK, ${summary.fail} FAIL`);

    return lines.join("\n");
}

/**
 * 格式化探针结果为 JSON
 */
function formatProbeJson(results: any[], summary: any, allOk: boolean): string {
    return JSON.stringify({
        results,
        summary,
        allOk,
    }, null, 2);
}

/**
 * 运行探针命令
 */
export async function probeCommand(jsonMode: boolean): Promise<void> {
    console.log("msgcode 2.0 probe\n");

    const config = getProbeConfig();
    const executor = new RealCommandExecutor();
    const report = await runProbes(config, executor);

    if (jsonMode) {
        console.log(formatProbeJson(report.results, report.summary, report.allOk));
    } else {
        console.log(formatProbeReport(report.results, report.summary));
    }

    // 返回码：全部 OK → 0；有 FAIL → 1
    process.exit(report.allOk ? 0 : 1);
}
